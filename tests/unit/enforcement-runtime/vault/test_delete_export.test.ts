import { describe, expect, it } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import { deleteOrTombstoneMemory, exportErasableMemory } from "../../../../packages/enforcement-runtime/src/vault/deletion";
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

describe("vault delete and export", () => {
  it("exports only user-visible erasable memory tiers", () => {
    const store = new InMemoryVaultStore();
    store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "CONSTITUTION",
        contentDigest: "sha256:constitution",
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "not_required"
    );
    store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "AUDIT",
        contentDigest: "sha256:audit",
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "not_required"
    );

    expect(exportErasableMemory(store, { tenantId: "tenant-a", userId: "user-a" }).map((record) => record.tier)).toEqual([
      "CONSTITUTION"
    ]);
  });

  it("deletes erasable records and tombstones audit records", () => {
    const store = new InMemoryVaultStore();
    const constitution = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "CONSTITUTION",
        contentDigest: "sha256:constitution",
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "not_required"
    ).record;
    const audit = store.write(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        tier: "AUDIT",
        contentDigest: "sha256:audit",
        now: "2026-07-07T12:00:00.000Z"
      },
      allowDecision,
      "not_required"
    ).record;

    expect(deleteOrTombstoneMemory(store, { tenantId: "tenant-a", userId: "user-a", id: constitution?.id ?? "" })).toEqual({
      deleted: true,
      tombstoned: false
    });
    expect(deleteOrTombstoneMemory(store, { tenantId: "tenant-a", userId: "user-a", id: audit?.id ?? "" })).toEqual({
      deleted: false,
      tombstoned: true
    });
    expect(store.list({ tenantId: "tenant-a", userId: "user-a" })).toEqual([]);
  });
});
