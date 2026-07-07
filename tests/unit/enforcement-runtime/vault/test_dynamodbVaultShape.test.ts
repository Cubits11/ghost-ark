import { describe, expect, it } from "vitest";
import { dynamoDbMemoryKey, toDynamoDbMemoryItem } from "../../../../packages/enforcement-runtime/src/vault/dynamodbStore";

describe("DynamoDB vault item shape", () => {
  it("partitions memory by tenant and user and stores only content digests", () => {
    const item = toDynamoDbMemoryItem(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        tier: "SESSION",
        contentDigest: "sha256:" + "a".repeat(64),
        classificationTags: ["preference"],
        expiresAt: "2026-07-08T00:00:00.000Z"
      },
      "2026-07-07T12:00:00.000Z"
    );

    expect(item.PK).toBe("TENANT#tenant-a#USER#user-a");
    expect(item.SK).toBe(`MEMORY#${item.id}`);
    expect(item.expiresAtEpoch).toBe(1783468800);
    expect(item.contentDigest).toBe("sha256:" + "a".repeat(64));
    expect(JSON.stringify(item)).not.toContain("rawContent");
    expect(JSON.stringify(item)).not.toContain("memoryText");
    expect(dynamoDbMemoryKey({ tenantId: "tenant-a", userId: "user-a", id: item.id })).toEqual({
      PK: "TENANT#tenant-a#USER#user-a",
      SK: `MEMORY#${item.id}`
    });
  });
});
