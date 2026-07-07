import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizationError } from "../../../shared/src/errors";
import { PolicyRepository, PolicyRepositoryLoadInput, DEFAULT_GOVERNED_INVOKE_POLICY } from "./repository";
import { validatePolicySource } from "./compiler";
import { PolicySource } from "./schema";

export interface DynamoDbPolicyRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
  defaultPolicy?: PolicySource;
}

interface PolicyItem {
  tenantId?: unknown;
  policySource?: unknown;
  active?: unknown;
}

function tenantPolicyPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function userPolicyPk(tenantId: string, userId: string): string {
  return `TENANT#${tenantId}#USER#${userId}`;
}

async function queryActivePolicies(client: DynamoDBDocumentClient, tableName: string, pk: string): Promise<PolicyItem[]> {
  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      FilterExpression: "active = :active",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":prefix": "POLICY#",
        ":active": true
      }
    })
  );
  return (response.Items ?? []) as PolicyItem[];
}

export class DynamoDbPolicyRepository implements PolicyRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;
  private readonly defaultPolicy: PolicySource;

  constructor(options: DynamoDbPolicyRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    this.defaultPolicy = options.defaultPolicy ?? DEFAULT_GOVERNED_INVOKE_POLICY;
  }

  async loadPolicies(input: PolicyRepositoryLoadInput): Promise<PolicySource[]> {
    if (!input.tenantId || !input.userId) {
      throw new AuthorizationError("Tenant and user identity are required to load policies");
    }

    const items = [
      ...(await queryActivePolicies(this.client, this.tableName, tenantPolicyPk(input.tenantId))),
      ...(await queryActivePolicies(this.client, this.tableName, userPolicyPk(input.tenantId, input.userId)))
    ];

    const policies = items.map((item) => {
      if (item.tenantId !== input.tenantId) {
        throw new AuthorizationError("Policy tenant mismatch", { requestedTenant: input.tenantId });
      }
      return validatePolicySource(item.policySource);
    });

    return policies.length > 0 ? policies : [this.defaultPolicy];
  }
}
