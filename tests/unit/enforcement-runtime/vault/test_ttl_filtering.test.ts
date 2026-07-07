import { describe, expect, it } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
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
});
