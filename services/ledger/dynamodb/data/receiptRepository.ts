import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ReceiptRecord, validateReceiptRecord } from "../../../../packages/receipt-schema/src/receipt";
import { NotFoundError } from "../../../../packages/shared/src/errors";

export interface ReceiptRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class ReceiptRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: ReceiptRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(record: ReceiptRecord): Promise<void> {
    const validated = validateReceiptRecord(record);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          tenantSlug: validated.payload.tenantSlug,
          receiptId: validated.payload.receiptId,
          status: validated.status,
          issuedAt: validated.payload.issuedAt,
          claimIds: validated.payload.claimIds,
          digestSha256: validated.signature.digestSha256,
          payload: validated.payload,
          signature: validated.signature,
          createdAt: validated.createdAt,
          updatedAt: validated.updatedAt
        },
        ConditionExpression: "attribute_not_exists(tenantSlug) AND attribute_not_exists(receiptId)"
      })
    );
  }

  async get(tenantSlug: string, receiptId: string): Promise<ReceiptRecord> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantSlug, receiptId }
      })
    );
    if (!response.Item) {
      throw new NotFoundError("Receipt not found", { tenantSlug, receiptId });
    }
    return validateReceiptRecord({
      payload: response.Item.payload,
      signature: response.Item.signature,
      status: response.Item.status,
      createdAt: response.Item.createdAt,
      updatedAt: response.Item.updatedAt
    });
  }

  async listByTenant(tenantSlug: string, limit = 50): Promise<ReceiptRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "tenantSlug = :tenantSlug",
        ExpressionAttributeValues: { ":tenantSlug": tenantSlug },
        ScanIndexForward: false,
        Limit: limit
      })
    );
    return (response.Items ?? []).map((item) =>
      validateReceiptRecord({
        payload: item.payload,
        signature: item.signature,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      })
    );
  }

  async markStatus(
    tenantSlug: string,
    receiptId: string,
    status: ReceiptRecord["status"],
    reason: string
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantSlug, receiptId },
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, statusReason = :reason",
        ConditionExpression: "attribute_exists(tenantSlug) AND attribute_exists(receiptId)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": new Date().toISOString(),
          ":reason": reason
        }
      })
    );
  }
}
