import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";

export interface ExecutionNonceReservation {
  tenantIdHash: string;
  nonce: string;
  executionContextHash: string;
  requestId: string;
  now: string;
  ttlSeconds?: number;
}

export interface ExecutionNonceStore {
  reserve(input: ExecutionNonceReservation): Promise<"RESERVED" | "IDEMPOTENT_REPLAY">;
}

export class ExecutionNonceReplayError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = "ExecutionNonceReplayError";
    this.context = context;
  }
}

export class InMemoryExecutionNonceStore implements ExecutionNonceStore {
  private readonly reservations = new Map<string, ExecutionNonceReservation>();

  async reserve(input: ExecutionNonceReservation): Promise<"RESERVED" | "IDEMPOTENT_REPLAY"> {
    const key = reservationKey(input.tenantIdHash, input.nonce);
    const existing = this.reservations.get(key);
    if (!existing) {
      this.reservations.set(key, input);
      return "RESERVED";
    }
    if (existing.executionContextHash !== input.executionContextHash) {
      throw new ExecutionNonceReplayError("Execution nonce replay detected with mismatched context hash", {
        tenantIdHash: input.tenantIdHash,
        nonceHash: nonceHash(input.nonce),
        existingContextHash: existing.executionContextHash,
        incomingContextHash: input.executionContextHash
      });
    }
    return "IDEMPOTENT_REPLAY";
  }
}

export interface DynamoDbExecutionNonceStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoDbExecutionNonceStore implements ExecutionNonceStore {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoDbExecutionNonceStoreOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async reserve(input: ExecutionNonceReservation): Promise<"RESERVED" | "IDEMPOTENT_REPLAY"> {
    const key = reservationKey(input.tenantIdHash, input.nonce);
    try {
      const item = {
        tenantIdHash: input.tenantIdHash,
        nonceHash: nonceHash(input.nonce),
        reservationKey: key,
        executionContextHash: input.executionContextHash,
        requestId: input.requestId,
        createdAt: input.now,
        ...(input.ttlSeconds ? { expiresAtEpoch: Math.floor(Date.parse(input.now) / 1000) + input.ttlSeconds } : {})
      };
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(reservationKey)"
        })
      );
      return "RESERVED";
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const existing = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { reservationKey: key },
          ConsistentRead: true
        })
      );
      const existingContextHash = existing.Item?.executionContextHash;
      if (existingContextHash === input.executionContextHash) {
        return "IDEMPOTENT_REPLAY";
      }
      throw new ExecutionNonceReplayError("Execution nonce replay detected with mismatched context hash", {
        tenantIdHash: input.tenantIdHash,
        nonceHash: nonceHash(input.nonce),
        existingContextHash,
        incomingContextHash: input.executionContextHash
      });
    }
  }
}

function reservationKey(tenantIdHash: string, nonce: string): string {
  return `${tenantIdHash}#${nonceHash(nonce)}`;
}

function nonceHash(nonce: string): string {
  return `sha256:${canonicalSha256Hex({ nonce })}`;
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
