import { ValidationError } from "../../shared/src/errors";
import type { IamPolicyDocument } from "./iamPolicies";
import type { LakeFormationPolicyPlan } from "./lfPolicies";
import type { TenantNamespace } from "./tenantNamespace";

export interface PolicyInvariantViolation {
  code: string;
  detail: string;
  sid?: string;
}

export interface PolicyInvariantResult {
  passed: boolean;
  violations: PolicyInvariantViolation[];
}

const RECEIPT_LEDGER_FORBIDDEN_ACTIONS = new Set([
  "dynamodb:BatchWriteItem",
  "dynamodb:DeleteItem",
  "dynamodb:PartiQLDelete",
  "dynamodb:PartiQLUpdate",
  "dynamodb:TransactWriteItems",
  "dynamodb:UpdateItem",
  "dynamodb:*",
  "*"
]);

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  return typeof value === "string" ? [value] : [];
}

function conditionValue(statement: Record<string, unknown>, conditionKey: string, attribute: string): string[] {
  const condition = statement.Condition as Record<string, unknown> | undefined;
  const block = condition?.[conditionKey] as Record<string, unknown> | undefined;
  return asArray(block?.[attribute]);
}

function statementSid(statement: Record<string, unknown>): string | undefined {
  return typeof statement.Sid === "string" ? statement.Sid : undefined;
}

function normalizedAction(action: string): string {
  return action.toLowerCase();
}

function isWildcardAction(action: string): boolean {
  return action.includes("*") || action.includes("?");
}

function isForbiddenReceiptLedgerAction(action: string): boolean {
  if (RECEIPT_LEDGER_FORBIDDEN_ACTIONS.has(action)) {
    return true;
  }
  const normalized = normalizedAction(action);
  return (
    normalized === "*" ||
    normalized === "dynamodb:*" ||
    /^dynamodb:(?:batchwrite|delete|partiqldelete|partiqlupdate|transactwrite|update)/u.test(normalized)
  );
}

export function verifyTenantSandboxPolicyInvariants(input: {
  document: IamPolicyDocument;
  namespace: TenantNamespace;
  accountId: string;
  region: string;
}): PolicyInvariantResult {
  const violations: PolicyInvariantViolation[] = [];
  const principalSlug = "${aws:PrincipalTag/slug}";
  const expectedReceiptArn = `arn:aws:dynamodb:${input.region}:${input.accountId}:table/ghost-ark-${input.namespace.stage}-receipts`;

  const hasRegionDeny = input.document.Statement.some(
    (statement) => statement.Effect === "Deny" && asArray(statement.Action).includes("*") && asArray(statement.Resource).includes("*")
  );
  if (!hasRegionDeny) {
    violations.push({ code: "missing_global_deny", detail: "Sandbox policy must include deny-first guardrails." });
  }

  for (const statement of input.document.Statement) {
    const sid = statementSid(statement);
    const effect = statement.Effect;
    const actions = asArray(statement.Action);
    const resources = asArray(statement.Resource);

    if (effect === "Allow" && ("NotAction" in statement || "NotResource" in statement)) {
      violations.push({
        code: "allow_not_action_or_resource",
        detail: "Allow statements cannot use NotAction or NotResource because the tenant boundary must be explicit.",
        sid
      });
    }
    if (effect === "Allow" && actions.some(isWildcardAction)) {
      violations.push({ code: "allow_wildcard_action", detail: "Allow statements cannot grant wildcard actions.", sid });
    }
    if (effect === "Allow" && resources.includes("*") && !actions.every((action) => /^athena:|^glue:|^lakeformation:/u.test(action))) {
      violations.push({
        code: "allow_wildcard_resource",
        detail: "Allow statements can use Resource '*' only for the bounded Glue/Athena/Lake Formation read workflow.",
        sid
      });
    }

    const referencesReceiptTable = resources.some((resource) => resource === expectedReceiptArn || /-receipts(?:$|\/)/u.test(resource));
    if (effect === "Allow" && referencesReceiptTable) {
      const forbidden = actions.filter(isForbiddenReceiptLedgerAction);
      if (forbidden.length > 0) {
        violations.push({
          code: "receipt_ledger_mutation",
          detail: `Receipt ledger grants are append-only; forbidden actions: ${forbidden.join(", ")}.`,
          sid
        });
      }
      const leadingKeys = conditionValue(statement, "ForAllValues:StringEquals", "dynamodb:LeadingKeys");
      if (!leadingKeys.includes(principalSlug)) {
        violations.push({
          code: "receipt_ledger_leading_keys",
          detail: "Receipt ledger access must be constrained by dynamodb:LeadingKeys to the principal slug.",
          sid
        });
      }
    }

    const tenantObjectResources = resources.filter((resource) => resource.includes(":s3:::") && resource.includes("/tenants/"));
    for (const resource of tenantObjectResources) {
      if (!resource.includes(`/tenants/${principalSlug}/`)) {
        violations.push({
          code: "s3_cross_tenant_prefix",
          detail: `S3 tenant object resource is not principal-tag scoped: ${resource}.`,
          sid
        });
      }
    }

    if (sid === "AllowTenantScopedBucketListing") {
      const prefixes = conditionValue(statement, "StringLike", "s3:prefix");
      if (!prefixes.every((prefix) => prefix === `tenants/${principalSlug}` || prefix === `tenants/${principalSlug}/*`)) {
        violations.push({
          code: "s3_list_prefix_escape",
          detail: "S3 ListBucket grants must be constrained to the caller tenant prefix.",
          sid
        });
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

export function verifyLakeFormationPolicyInvariants(input: LakeFormationPolicyPlan): PolicyInvariantResult {
  const violations: PolicyInvariantViolation[] = [];
  const tenantSlug = input.namespace.tenantSlug;
  if (input.rowFilterExpression !== `tenant_slug = '${tenantSlug}'`) {
    violations.push({
      code: "lakeformation_row_filter_escape",
      detail: `Row filter must be exactly tenant_slug = '${tenantSlug}'.`
    });
  }
  for (const grant of input.grants) {
    if (grant.condition && grant.condition.tenantSlug !== tenantSlug) {
      violations.push({
        code: "lakeformation_condition_tenant_mismatch",
        detail: "Lake Formation grant condition tenantSlug must match the compiled namespace."
      });
    }
    if (grant.permissions.includes("DROP" as never) || grant.permissions.includes("DELETE" as never)) {
      violations.push({
        code: "lakeformation_destructive_permission",
        detail: "Tenant Lake Formation grants cannot include destructive table permissions."
      });
    }
  }
  return { passed: violations.length === 0, violations };
}

export function assertPolicyInvariants(result: PolicyInvariantResult): void {
  if (!result.passed) {
    throw new ValidationError("Compiled policy violates Ghost Ark tenant isolation invariants", {
      violations: result.violations
    });
  }
}
