import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { decisionReceiptDigest, decisionReceiptRequestDigest, signedDecisionReceiptHash } from "./canonical";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export type DecisionReceiptPersistenceStatus = "CREATED" | "IDEMPOTENT_EXISTING";
const CHAIN_HEAD_RECEIPT_ID = "__chain_head__";
const REQUEST_MARKER_PREFIX = "__request__#";

export interface DecisionReceiptChainHead {
  tenantId: string;
  receiptId: string;
  headHash: string;
  updatedAt: string;
}

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

export class ChainHeadConflictError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = "ChainHeadConflictError";
    this.context = context;
  }
}

export interface DecisionReceiptRepository {
  put(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult>;
  get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null>;
  latestHashForTenant?(input: { tenantId: string }): Promise<string | null>;
  listChainHeads?(): Promise<DecisionReceiptChainHead[]>;
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
    const requestMarkerId = requestMarkerReceiptId(validated.request_id);
    const requestDigest = decisionReceiptRequestDigest(validated);
    const receiptHash = signedDecisionReceiptHash(validated);
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  tenantId: validated.tenant_id_hash,
                  receiptId: validated.receipt_id,
                  requestId: validated.request_id,
                  modelId: validated.model_id,
                  policyHash: validated.policy_hash,
                  timestamp: validated.timestamp,
                  persistedAt,
                  receiptHash,
                  requestDigest,
                  prevReceiptHash: validated.prev_receipt_hash,
                  receipt: validated
                },
                ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)"
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  tenantId: validated.tenant_id_hash,
                  receiptId: requestMarkerId,
                  requestId: validated.request_id,
                  requestDigest,
                  targetReceiptId: validated.receipt_id,
                  persistedAt
                },
                ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)"
              }
            },
            chainHeadTransactItem(this.tableName, validated, receiptHash, persistedAt)
          ]
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
        Key: { tenantId: input.tenantId, receiptId: input.receiptId },
        ConsistentRead: true
      })
    );
    return response.Item?.receipt ? validateSignedDecisionReceipt(response.Item.receipt) : null;
  }

  async latestHashForTenant(input: { tenantId: string }): Promise<string | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId: input.tenantId, receiptId: CHAIN_HEAD_RECEIPT_ID },
        ConsistentRead: true
      })
    );
    return typeof response.Item?.headHash === "string" ? response.Item.headHash : null;
  }

  async listChainHeads(): Promise<DecisionReceiptChainHead[]> {
    const response = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "receiptId = :head",
        ExpressionAttributeValues: { ":head": CHAIN_HEAD_RECEIPT_ID },
        ConsistentRead: true
      })
    );
    return (response.Items ?? [])
      .map((item) => ({
        tenantId: String(item.tenantId),
        receiptId: typeof item.latestReceiptId === "string" ? item.latestReceiptId : "",
        headHash: typeof item.headHash === "string" ? item.headHash : "",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
      }))
      .filter((head) => head.tenantId.length > 0 && head.receiptId.length > 0 && head.headHash.length > 0);
  }

  private async resolveConditionalCollision(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult> {
    const requestMarker = await this.getRawItem(receipt.tenant_id_hash, requestMarkerReceiptId(receipt.request_id));
    if (requestMarker) {
      return this.resolveRequestMarkerCollision(receipt, requestMarker);
    }

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
      const observedHead = await this.latestHashForTenant({ tenantId: receipt.tenant_id_hash });
      if (observedHead !== receipt.prev_receipt_hash) {
        throw new ChainHeadConflictError("Receipt chain head advanced before receipt could be persisted", {
          tenantId: receipt.tenant_id_hash,
          receiptId: receipt.receipt_id,
          expectedPreviousHash: receipt.prev_receipt_hash,
          observedHead
        });
      }
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

  private async resolveRequestMarkerCollision(
    receipt: SignedDecisionReceipt,
    marker: Record<string, unknown>
  ): Promise<DecisionReceiptPersistenceResult> {
    const targetReceiptId = typeof marker.targetReceiptId === "string" ? marker.targetReceiptId : "";
    const storedReceipt = targetReceiptId
      ? await this.get({ tenantId: receipt.tenant_id_hash, receiptId: targetReceiptId })
      : null;
    if (!storedReceipt) {
      throw new IntegrityCollisionError("Receipt request marker exists but the target receipt was not found", {
        tenantId: receipt.tenant_id_hash,
        requestId: receipt.request_id,
        targetReceiptId
      });
    }

    const incomingRequestDigest = decisionReceiptRequestDigest(receipt);
    const storedRequestDigest =
      typeof marker.requestDigest === "string" ? marker.requestDigest : decisionReceiptRequestDigest(storedReceipt);
    if (incomingRequestDigest !== storedRequestDigest) {
      throw new IntegrityCollisionError("Receipt request id replay detected with mismatched canonical request digest", {
        tenantId: receipt.tenant_id_hash,
        requestId: receipt.request_id,
        incomingRequestDigest,
        storedRequestDigest
      });
    }

    return {
      status: "IDEMPOTENT_EXISTING",
      receipt: storedReceipt,
      persistedAt: typeof marker.persistedAt === "string" ? marker.persistedAt : storedReceipt.timestamp
    };
  }

  private async getRawItem(tenantId: string, receiptId: string): Promise<Record<string, unknown> | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, receiptId },
        ConsistentRead: true
      })
    );
    return (response.Item as Record<string, unknown> | undefined) ?? null;
  }
}

function requestMarkerReceiptId(requestId: string): string {
  return `${REQUEST_MARKER_PREFIX}${encodeURIComponent(requestId)}`;
}

function chainHeadTransactItem(
  tableName: string,
  receipt: SignedDecisionReceipt,
  receiptHash: string,
  persistedAt: string
): NonNullable<TransactWriteCommand["input"]["TransactItems"]>[number] {
  const item = {
    tenantId: receipt.tenant_id_hash,
    receiptId: CHAIN_HEAD_RECEIPT_ID,
    headHash: receiptHash,
    previousHash: receipt.prev_receipt_hash,
    latestReceiptId: receipt.receipt_id,
    updatedAt: persistedAt
  };
  if (receipt.prev_receipt_hash === null) {
    return {
      Put: {
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)"
      }
    };
  }
  return {
    Update: {
      TableName: tableName,
      Key: { tenantId: receipt.tenant_id_hash, receiptId: CHAIN_HEAD_RECEIPT_ID },
      UpdateExpression:
        "SET headHash = :headHash, previousHash = :previousHash, latestReceiptId = :latestReceiptId, updatedAt = :updatedAt",
      ConditionExpression: "headHash = :previousHash",
      ExpressionAttributeValues: {
        ":headHash": receiptHash,
        ":previousHash": receipt.prev_receipt_hash,
        ":latestReceiptId": receipt.receipt_id,
        ":updatedAt": persistedAt
      }
    }
  };
}
