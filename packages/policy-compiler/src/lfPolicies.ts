import {
  CreateLFTagCommand,
  GrantPermissionsCommand,
  LakeFormationClient,
  LFTagPair,
  Resource,
  Permission
} from "@aws-sdk/client-lakeformation";
import { canonicalSha256Hex } from "../../receipt-schema/src/hashCanonicalization";
import { TenantNamespace, compileTenantNamespace, TenantNamespaceInput } from "./tenantNamespace";
import { assertPolicyInvariants, verifyLakeFormationPolicyInvariants } from "./invariants";

export interface LakeFormationPolicyInput extends TenantNamespaceInput {
  producerRoleArn: string;
  consumerRoleArn: string;
  databaseName?: string;
  tableName: string;
  allowedColumns?: string[];
  rowFilterExpression?: string;
  classification?: "public" | "internal" | "confidential" | "restricted";
}

export interface LakeFormationGrantSpec {
  principalArn: string;
  permissions: Permission[];
  resource: Resource;
  condition?: Record<string, unknown>;
}

export interface LakeFormationPolicyPlan {
  namespace: TenantNamespace;
  tags: LFTagPair[];
  grants: LakeFormationGrantSpec[];
  rowFilterExpression: string;
  columnAllowList: string[];
  hash: string;
}

export function compileLakeFormationPolicy(input: LakeFormationPolicyInput): LakeFormationPolicyPlan {
  const namespace = compileTenantNamespace(input);
  const databaseName = input.databaseName ?? namespace.glue.databaseName;
  const classification = input.classification ?? "internal";
  const allowedColumns = input.allowedColumns ?? [];
  const rowFilterExpression = input.rowFilterExpression ?? `tenant_slug = '${namespace.tenantSlug}'`;
  const tags: LFTagPair[] = [
    { CatalogId: undefined, TagKey: "tenant_slug", TagValues: [namespace.tenantSlug] },
    { CatalogId: undefined, TagKey: "classification", TagValues: [classification] },
    { CatalogId: undefined, TagKey: "evidence_role", TagValues: ["raw", "curated", "receipt", "export"] }
  ];

  const tableWithColumns: Resource =
    allowedColumns.length > 0
      ? {
          TableWithColumns: {
            DatabaseName: databaseName,
            Name: input.tableName,
            ColumnNames: allowedColumns
          }
        }
      : {
          Table: {
            DatabaseName: databaseName,
            Name: input.tableName
          }
        };

  const grants: LakeFormationGrantSpec[] = [
    {
      principalArn: input.producerRoleArn,
      permissions: ["DESCRIBE", "SELECT", "INSERT", "ALTER"],
      resource: {
        Table: {
          DatabaseName: databaseName,
          Name: input.tableName
        }
      }
    },
    {
      principalArn: input.consumerRoleArn,
      permissions: ["DESCRIBE", "SELECT"],
      resource: tableWithColumns,
      condition: {
        rowFilterExpression,
        tenantSlug: namespace.tenantSlug,
        classification
      }
    }
  ];

  const planWithoutHash = {
    namespace,
    tags,
    grants,
    rowFilterExpression,
    columnAllowList: allowedColumns
  };

  const plan = {
    ...planWithoutHash,
    hash: canonicalSha256Hex(planWithoutHash)
  };
  assertPolicyInvariants(verifyLakeFormationPolicyInvariants(plan));
  return plan;
}

export async function deployLakeFormationPolicy(
  client: LakeFormationClient,
  plan: LakeFormationPolicyPlan
): Promise<void> {
  for (const tag of plan.tags) {
    await client.send(
      new CreateLFTagCommand({
        TagKey: tag.TagKey,
        TagValues: tag.TagValues ?? []
      })
    );
  }

  for (const grant of plan.grants) {
    await client.send(
      new GrantPermissionsCommand({
        Principal: { DataLakePrincipalIdentifier: grant.principalArn },
        Permissions: grant.permissions,
        Resource: grant.resource
      })
    );
  }
}
