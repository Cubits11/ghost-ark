import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import { DynamoDbVaultStore, toDynamoDbMemoryItem } from "../../../../packages/enforcement-runtime/src/vault/dynamodbStore";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";

const allowDecision: PolicyDecision = {
  schemaVersion: "ghost.policy.decision.v1",
  phase: "memory_write",
  decision: "ALLOW",
  policyVersion: "test",
  policyHash: "a".repeat(64),
  matchedRuleIds: [],
  matchedLayers: [],
  actionTaken: [],
  riskScore: 0,
  reasons: []
};

describe("vault TTL filtering", () => {
  it("ignores expired session records immediately during reads", () => {
    const store = new InMemoryVaultStore();
    const write = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        tier: "SESSION",
        contentDigest: "sha256:session",
        expiresAt: "2026-07-07T12:30:00.000Z",
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "not_required"
    );

    expect(write.written).toBe(true);
    expect(store.list({ tenantId: "tenant-a", userId: "user-a", now: "2026-07-07T12:29:59.000Z" })).toHaveLength(1);
    expect(store.list({ tenantId: "tenant-a", userId: "user-a", now: "2026-07-07T12:30:00.000Z" })).toEqual([]);
  });

  it("requires session memory to declare expiration", () => {
    const store = new InMemoryVaultStore();
    expect(() =>
      store.write(
        {
          tenantId: "tenant-a",
          userId: "user-a",
          sessionId: "session-a",
          tier: "SESSION",
          contentDigest: "sha256:session"
        },
        allowDecision,
        "not_required"
      )
    ).toThrow(/SESSION memory requires/u);
  });

  it("sends a DynamoDB query with read-time expiry, tombstone, session, and tier filters", async () => {
    let sentCommand: QueryCommand | undefined;
    const send = vi.fn(async (command: QueryCommand) => {
      sentCommand = command;
      return { Items: [] };
    });
    const store = new DynamoDbVaultStore({ tableName: "vault", client: { send } as never });

    await store.list({
      tenantId: "tenant-a",
      userId: "user-a",
      sessionId: "session-a",
      includeTiers: ["SESSION", "AUDIT"],
      now: "2026-07-07T12:00:00.000Z"
    });

    const command = sentCommand;
    if (!command) {
      throw new Error("Expected DynamoDB QueryCommand to be sent");
    }
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      TableName: "vault",
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": "TENANT#tenant-a#USER#user-a",
        ":prefix": "MEMORY#",
        ":now": "2026-07-07T12:00:00.000Z",
        ":sessionId": "session-a",
        ":tier0": "AUDIT",
        ":tier1": "SESSION"
      },
      ExpressionAttributeNames: {
        "#tier": "tier"
      }
    });
    expect(command.input.FilterExpression).toContain("attribute_not_exists(expiresAt) OR expiresAt > :now");
    expect(command.input.FilterExpression).toContain("attribute_not_exists(tombstonedAt)");
    expect(command.input.FilterExpression).toContain("sessionId = :sessionId");
    expect(command.input.FilterExpression).toContain("#tier IN (:tier0, :tier1)");
  });

  it("filters expired, tombstoned, and wrong-session records even when DynamoDB TTL has not removed them", async () => {
    const active = toDynamoDbMemoryItem(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        tier: "SESSION",
        contentDigest: "sha256:active",
        expiresAt: "2026-07-07T12:30:00.000Z"
      },
      "2026-07-07T12:00:00.000Z"
    );
    const expired = toDynamoDbMemoryItem(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        tier: "SESSION",
        contentDigest: "sha256:expired",
        expiresAt: "2026-07-07T11:59:59.000Z"
      },
      "2026-07-07T11:00:00.000Z"
    );
    const tombstoned = {
      ...toDynamoDbMemoryItem(
        {
          tenantId: "tenant-a",
          userId: "user-a",
          sessionId: "session-a",
          tier: "AUDIT",
          contentDigest: "sha256:tombstoned"
        },
        "2026-07-07T11:00:00.000Z"
      ),
      tombstonedAt: "2026-07-07T11:30:00.000Z"
    };
    const wrongSession = toDynamoDbMemoryItem(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-b",
        tier: "SESSION",
        contentDigest: "sha256:wrong-session",
        expiresAt: "2026-07-07T12:30:00.000Z"
      },
      "2026-07-07T12:00:00.000Z"
    );
    const send = vi.fn(async () => ({ Items: [expired, tombstoned, wrongSession, active] }));
    const store = new DynamoDbVaultStore({ tableName: "vault", client: { send } as never });

    const records = await store.list({
      tenantId: "tenant-a",
      userId: "user-a",
      sessionId: "session-a",
      now: "2026-07-07T12:00:00.000Z"
    });

    expect(records.map((record) => record.contentDigest)).toEqual(["sha256:active"]);
  });
});
