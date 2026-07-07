import { describe, expect, it } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";

function decision(decisionValue: PolicyDecision["decision"]): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase: "memory_write",
    decision: decisionValue,
    policyVersion: "test",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: [],
    riskScore: 0,
    reasons: []
  };
}

describe("vault memory suppression", () => {
  it("does not persist when the policy decision is MEMORY_SUPPRESS", () => {
    const store = new InMemoryVaultStore();
    const result = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        tier: "SESSION",
        contentDigest: "sha256:abc",
        expiresAt: "2026-07-07T13:00:00.000Z",
        now: "2026-07-07T12:00:00.000Z"
      },
      decision("MEMORY_SUPPRESS")
    );

    expect(result.written).toBe(false);
    expect(store.list({ tenantId: "tenant-a", userId: "user-a", now: "2026-07-07T12:00:00.000Z" })).toEqual([]);
  });

  it("never persists KAPPA invocation-only memory", () => {
    const store = new InMemoryVaultStore();
    const result = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "KAPPA",
        contentDigest: "sha256:kappa",
        now: "2026-07-07T12:00:00.000Z"
      },
      decision("ALLOW"),
      "not_required"
    );

    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/never persisted/u);
  });
});
