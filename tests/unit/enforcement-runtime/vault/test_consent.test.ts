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

describe("vault restricted-memory consent", () => {
  it("does not write restricted memory without explicit consent", () => {
    const store = new InMemoryVaultStore();
    const result = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "RESTRICTED",
        contentDigest: "sha256:restricted",
        classificationTags: ["restricted"],
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "missing"
    );

    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/requires explicit consent/u);
  });

  it("writes restricted memory when explicit consent is granted", () => {
    const store = new InMemoryVaultStore();
    const result = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "RESTRICTED",
        contentDigest: "sha256:restricted",
        classificationTags: ["restricted"],
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "granted"
    );

    expect(result.written).toBe(true);
    expect(store.list({ tenantId: "tenant-a", userId: "user-a", now: "2026-07-07T12:00:01.000Z" })).toHaveLength(1);
  });
});
