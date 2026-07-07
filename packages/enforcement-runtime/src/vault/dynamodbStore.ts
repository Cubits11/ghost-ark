import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { AuthorizationError, ValidationError } from "../../../shared/src/errors";
import { ConsentState, PolicyDecision } from "../policy/decisions";
import { hasRestrictedMemoryConsent, restrictedConsentReason } from "./consent";
import { MemoryReadRequest, MemoryWriteRequest, MemoryWriteResult, VaultIdentity, VaultStore } from "./store";
import { MemoryRecord } from "./tiers";

export interface DynamoDbVaultStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export interface DynamoDbMemoryKey {
  PK: string;
  SK: string;
}

export interface DynamoDbMemoryItem extends DynamoDbMemoryKey {
  id: string;
  tenantId: string;
  userId: string;
  sessionId?: string;
  tier: MemoryRecord["tier"];
  contentDigest: string;
  classificationTags: string[];
  createdAt: string;
  expiresAt?: string;
  expiresAtEpoch?: number;
  tombstonedAt?: string;
}

function identityPk(input: VaultIdentity): string {
  return `TENANT#${input.tenantId}#USER#${input.userId}`;
}

function recordId(input: MemoryWriteRequest): string {
  return `mem_${canonicalSha256Hex({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    tier: input.tier,
    contentDigest: input.contentDigest
  })}`;
}

function epochSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function isExpired(record: MemoryRecord, now: string): boolean {
  return Boolean(record.expiresAt && record.expiresAt <= now);
}

export function dynamoDbMemoryKey(input: VaultIdentity & { id: string }): DynamoDbMemoryKey {
  return {
    PK: identityPk(input),
    SK: `MEMORY#${input.id}`
  };
}

export function toDynamoDbMemoryItem(input: MemoryWriteRequest, now: string): DynamoDbMemoryItem {
  const id = recordId(input);
  return {
    ...dynamoDbMemoryKey({ ...input, id }),
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    tier: input.tier,
    contentDigest: input.contentDigest,
    classificationTags: [...(input.classificationTags ?? [])].sort(),
    createdAt: now,
    expiresAt: input.expiresAt,
    expiresAtEpoch: epochSeconds(input.expiresAt)
  };
}

export function fromDynamoDbMemoryItem(item: DynamoDbMemoryItem): MemoryRecord {
  return {
    id: item.id,
    tenantId: item.tenantId,
    userId: item.userId,
    sessionId: item.sessionId,
    tier: item.tier,
    contentDigest: item.contentDigest,
    classificationTags: [...item.classificationTags].sort(),
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    tombstonedAt: item.tombstonedAt
  };
}

export class DynamoDbVaultStore implements VaultStore {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoDbVaultStoreOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async write(request: MemoryWriteRequest, decision: PolicyDecision, consentState: ConsentState = "missing"): Promise<MemoryWriteResult> {
    if (decision.decision === "MEMORY_SUPPRESS") {
      return { written: false, reason: "policy decision MEMORY_SUPPRESS prevented persistence" };
    }
    if (request.tier === "KAPPA") {
      return { written: false, reason: "KAPPA memory is invocation-only and is never persisted" };
    }
    if (request.tier === "SESSION" && !request.expiresAt) {
      throw new ValidationError("SESSION memory requires an explicit expiresAt timestamp");
    }
    if (!hasRestrictedMemoryConsent(request.tier, consentState)) {
      return {
        written: false,
        reason: restrictedConsentReason(request.tier, consentState) ?? "restricted memory consent missing"
      };
    }

    const now = request.now ?? new Date().toISOString();
    const item = toDynamoDbMemoryItem(request, now);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      })
    );
    return { written: true, reason: "memory persisted", record: fromDynamoDbMemoryItem(item) };
  }

  async list(request: MemoryReadRequest): Promise<MemoryRecord[]> {
    const now = request.now ?? new Date().toISOString();
    const includeTiers = new Set(request.includeTiers ?? ["SESSION", "CONSTITUTION", "AUDIT", "RESTRICTED"]);
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": identityPk(request),
          ":prefix": "MEMORY#"
        }
      })
    );
    return ((response.Items ?? []) as DynamoDbMemoryItem[])
      .map(fromDynamoDbMemoryItem)
      .filter((record) => !request.sessionId || record.sessionId === request.sessionId)
      .filter((record) => includeTiers.has(record.tier))
      .filter((record) => !record.tombstonedAt)
      .filter((record) => !isExpired(record, now))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(request: VaultIdentity & { id: string; now?: string }): Promise<MemoryRecord> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: dynamoDbMemoryKey(request)
      })
    );
    if (!response.Item) {
      throw new ValidationError("Memory record is unavailable");
    }
    const record = fromDynamoDbMemoryItem(response.Item as DynamoDbMemoryItem);
    if (record.tenantId !== request.tenantId || record.userId !== request.userId) {
      throw new AuthorizationError("Cross-tenant or cross-user memory access denied", { requestedId: request.id });
    }
    if (record.tombstonedAt || isExpired(record, request.now ?? new Date().toISOString())) {
      throw new ValidationError("Memory record is unavailable");
    }
    return record;
  }

  async tombstone(request: VaultIdentity & { id: string; now?: string }): Promise<MemoryRecord> {
    const record = await this.get(request);
    const tombstonedAt = request.now ?? new Date().toISOString();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: dynamoDbMemoryKey(request),
        UpdateExpression: "SET tombstonedAt = :tombstonedAt",
        ExpressionAttributeValues: { ":tombstonedAt": tombstonedAt }
      })
    );
    return { ...record, tombstonedAt };
  }

  async deleteErasable(request: VaultIdentity & { id: string; now?: string }): Promise<void> {
    const record = await this.get(request);
    if (record.tier === "AUDIT") {
      await this.tombstone(request);
      return;
    }
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: dynamoDbMemoryKey(request)
      })
    );
  }

  async exportUserMemory(request: VaultIdentity & { now?: string }): Promise<MemoryRecord[]> {
    return this.list({ ...request, includeTiers: ["SESSION", "CONSTITUTION", "RESTRICTED"], now: request.now });
  }
}
