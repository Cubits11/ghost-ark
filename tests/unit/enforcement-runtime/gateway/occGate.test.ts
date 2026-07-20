import { describe, it, expect } from "vitest";
import { evaluateOCCGate, computeReadSetProjectionHash } from "../../../../packages/enforcement-runtime/src/gateway/occGate";

describe("OCC Gate Enforcer (Gate 2)", () => {
  it("admits transaction when read-set projection hashes match exactly", () => {
    const forkReadSet = { "s3://bucket/doc1": "hashA", "s3://bucket/doc2": "hashB" };
    const commitReadSet = { "s3://bucket/doc1": "hashA", "s3://bucket/doc2": "hashB" };

    const result = evaluateOCCGate({
      trajectoryId: "traj-100",
      forkReadSet,
      commitReadSet
    });

    expect(result.admitted).toBe(true);
    expect(result.forkProjectionHash).toBe(result.commitProjectionHash);
    expect(result.conflictingKeys).toHaveLength(0);
  });

  it("fails closed when concurrent write alters read-set hash between fork and commit", () => {
    const forkReadSet = { "s3://bucket/doc1": "hashA", "s3://bucket/doc2": "hashB" };
    const commitReadSet = { "s3://bucket/doc1": "hashA", "s3://bucket/doc2": "hashB_MUTATED" };

    const result = evaluateOCCGate({
      trajectoryId: "traj-101",
      forkReadSet,
      commitReadSet
    });

    expect(result.admitted).toBe(false);
    expect(result.conflictingKeys).toContain("s3://bucket/doc2");
    expect(result.reason).toContain("OCC read-set projection conflict");
  });

  it("computes deterministic projection hash regardless of key insertion order", () => {
    const hash1 = computeReadSetProjectionHash({ a: "1", b: "2" });
    const hash2 = computeReadSetProjectionHash({ b: "2", a: "1" });
    expect(hash1).toBe(hash2);
  });
});
