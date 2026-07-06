import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ClaimEnvelope, ClaimState, validateClaimEnvelope } from "../../../../packages/receipt-schema/src/claimEnvelope";
import { NotFoundError } from "../../../../packages/shared/src/errors";

export interface ClaimRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class ClaimRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: ClaimRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(claim: ClaimEnvelope): Promise<void> {
    const validated = validateClaimEnvelope(claim);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: validated,
        ConditionExpression: "attribute_not_exists(tenantSlug) AND attribute_not_exists(claimId)"
      })
    );
  }

  async get(tenantSlug: string, claimId: string): Promise<ClaimEnvelope> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantSlug, claimId }
      })
    );
    if (!response.Item) {
      throw new NotFoundError("Claim not found", { tenantSlug, claimId });
    }
    return validateClaimEnvelope(response.Item);
  }

  async list(tenantSlug: string, state?: ClaimState, limit = 100): Promise<ClaimEnvelope[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "tenantSlug = :tenantSlug",
        FilterExpression: state ? "#state = :state" : undefined,
        ExpressionAttributeNames: state ? { "#state": "state" } : undefined,
        ExpressionAttributeValues: state ? { ":tenantSlug": tenantSlug, ":state": state } : { ":tenantSlug": tenantSlug },
        Limit: limit
      })
    );
    return (response.Items ?? []).map(validateClaimEnvelope);
  }

  async attachReceipt(tenantSlug: string, claimId: string, receiptId: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantSlug, claimId },
        UpdateExpression: "SET receiptIds = list_append(if_not_exists(receiptIds, :empty), :receipt), updatedAt = :updatedAt",
        ConditionExpression: "attribute_exists(tenantSlug) AND attribute_exists(claimId)",
        ExpressionAttributeValues: {
          ":empty": [],
          ":receipt": [receiptId],
          ":updatedAt": new Date().toISOString()
        }
      })
    );
  }
}
