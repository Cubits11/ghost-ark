import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export interface DecisionReceiptRepository {
  put(receipt: SignedDecisionReceipt): Promise<void>;
  get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null>;
  latestHashForSession?(input: { tenantId: string; userId: string; sessionId: string }): Promise<string | null>;
}

export interface DynamoDbDecisionReceiptRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoDbDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoDbDecisionReceiptRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(receipt: SignedDecisionReceipt): Promise<void> {
    const validated = validateSignedDecisionReceipt(receipt);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          tenantId: validated.tenant_id_hash,
          receiptId: validated.receipt_id,
          requestId: validated.request_id,
          modelId: validated.model_id,
          policyHash: validated.policy_hash,
          timestamp: validated.timestamp,
          receipt: validated
        },
        ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)"
      })
    );
  }

  async get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId: input.tenantId, receiptId: input.receiptId }
      })
    );
    return response.Item?.receipt ? validateSignedDecisionReceipt(response.Item.receipt) : null;
  }
}
