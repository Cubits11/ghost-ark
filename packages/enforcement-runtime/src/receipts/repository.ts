import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { decisionReceiptDigest } from "./canonical";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export type DecisionReceiptPersistenceStatus = "CREATED" | "IDEMPOTENT_EXISTING";

export interface DecisionReceiptPersistenceResult {
  status: DecisionReceiptPersistenceStatus;
  receipt: SignedDecisionReceipt;
  persistedAt: string;
}

export class IntegrityCollisionError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = "IntegrityCollisionError";
    this.context = context;
  }
}

export interface DecisionReceiptRepository {
  put(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult>;
  get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null>;
  latestHashForSession?(input: { tenantId: string; userId: string; sessionId: string }): Promise<string | null>;
}

export interface DynamoDbDecisionReceiptRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

function isConditionalCheckFailed(error: unknown): boolean {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    Code?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code =
    typeof candidate.code === "string" ? candidate.code : typeof candidate.Code === "string" ? candidate.Code : "";
  const message = error instanceof Error ? error.message : typeof candidate.message === "string" ? candidate.message : "";
  const httpStatusCode = candidate.$metadata?.httpStatusCode;
  const errorText = `${name} ${code} ${message}`;

  return (
    name === "ConditionalCheckFailedException" ||
    code === "ConditionalCheckFailedException" ||
    (httpStatusCode === 400 && /ConditionalCheckFailed|conditional check/iu.test(errorText))
  );
}

function persistedAtFromItem(item: Record<string, unknown> | undefined, receipt: SignedDecisionReceipt): string {
  return typeof item?.persistedAt === "string" ? item.persistedAt : receipt.timestamp;
}

export class DynamoDbDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoDbDecisionReceiptRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult> {
    const validated = validateSignedDecisionReceipt(receipt);
    const persistedAt = validated.timestamp;
    try {
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
            persistedAt,
            receipt: validated
          },
          ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)"
        })
      );
      return { status: "CREATED", receipt: validated, persistedAt };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      return this.resolveConditionalCollision(validated);
    }
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

  private async resolveConditionalCollision(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId: receipt.tenant_id_hash, receiptId: receipt.receipt_id },
        ConsistentRead: true
      })
    );
    const item = response.Item as Record<string, unknown> | undefined;
    const storedReceipt = item?.receipt ? validateSignedDecisionReceipt(item.receipt) : null;
    if (!storedReceipt) {
      throw new IntegrityCollisionError("Receipt conditional write failed but no existing receipt was found", {
        tenantId: receipt.tenant_id_hash,
        receiptId: receipt.receipt_id
      });
    }

    const incomingDigest = decisionReceiptDigest(receipt);
    const storedDigest = decisionReceiptDigest(storedReceipt);
    if (incomingDigest !== storedDigest) {
      throw new IntegrityCollisionError("Receipt primary key collision detected with mismatched canonical digests", {
        tenantId: receipt.tenant_id_hash,
        receiptId: receipt.receipt_id,
        incomingDigest,
        storedDigest
      });
    }

    return {
      status: "IDEMPOTENT_EXISTING",
      receipt: storedReceipt,
      persistedAt: persistedAtFromItem(item, storedReceipt)
    };
  }
}
