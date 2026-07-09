import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE_ROOT,
  computeMerkleRoot,
  getConsistencyProof,
  getInclusionProof,
  leafHash,
  nodeHash,
  verifyConsistencyProof,
  verifyInclusionProof,
} from "../../../packages/research-frontier/src/merkle";

describe("research frontier Merkle proofs", () => {
  it("uses a deterministic split tree shape for non-power-of-two trees", () => {
    const hashes = ["receipt-a", "receipt-b", "receipt-c"].map(leafHash);

    expect(computeMerkleRoot(["receipt-a", "receipt-b", "receipt-c"])).toBe(
      nodeHash(nodeHash(hashes[0], hashes[1]), hashes[2]),
    );
  });

  it("generates and verifies inclusion proofs for 1 through 4 leaves", () => {
    for (let treeSize = 1; treeSize <= 4; treeSize += 1) {
      const payloads = Array.from(
        { length: treeSize },
        (_, index) => `receipt-${index}`,
      );

      for (let leafIndex = 0; leafIndex < payloads.length; leafIndex += 1) {
        const proof = getInclusionProof(leafIndex, payloads);

        expect(proof.tree_size).toBe(treeSize);
        expect(proof.leaf_index).toBe(leafIndex);
        expect(proof.root_hash).toBe(computeMerkleRoot(payloads));
        expect(verifyInclusionProof({ payload: payloads[leafIndex], proof })).toBe(
          true,
        );
      }
    }
  });

  it("returns expected inclusion audit paths for fixed leaves", () => {
    const payloads = ["receipt-a", "receipt-b", "receipt-c", "receipt-d"];
    const hashes = payloads.map(leafHash);
    const proof = getInclusionProof(2, payloads);

    expect(proof.audit_path).toEqual([
      { position: "right", hash: hashes[3] },
      { position: "left", hash: nodeHash(hashes[0], hashes[1]) },
    ]);
  });

  it("rejects tampered inclusion proof inputs", () => {
    const payloads = ["receipt-a", "receipt-b", "receipt-c"];
    const proof = getInclusionProof(1, payloads);

    expect(verifyInclusionProof({ payload: "receipt-x", proof })).toBe(false);
    expect(
      verifyInclusionProof({
        payload: payloads[1],
        proof,
        expectedRoot: "a".repeat(64),
      }),
    ).toBe(false);
    expect(
      verifyInclusionProof({
        payload: payloads[1],
        proof: {
          ...proof,
          audit_path: [{ position: "left", hash: "not-a-hash" }],
        },
      }),
    ).toBe(false);
    expect(
      verifyInclusionProof({
        payload: payloads[1],
        proof: {
          ...proof,
          audit_path: proof.audit_path.map((step) => ({
            ...step,
            position: step.position === "left" ? "right" : "left",
          })),
        },
      }),
    ).toBe(false);
  });

  it("fails closed when inclusion proof indexes are out of range", () => {
    expect(() => getInclusionProof(0, [])).toThrow(/existing tree leaf/i);

    const proof = getInclusionProof(0, ["receipt-a"]);

    expect(
      verifyInclusionProof({
        payload: "receipt-a",
        proof: { ...proof, leaf_index: 1 },
      }),
    ).toBe(false);
    expect(
      verifyInclusionProof({
        payload: "receipt-a",
        proof: {
          ...proof,
          audit_path: [{ position: "right", hash: leafHash("extra") }],
          root_hash: nodeHash(proof.leaf_hash, leafHash("extra")),
        },
      }),
    ).toBe(false);
  });

  it("generates RFC-style consistency proof paths for fixed growth windows", () => {
    const payloads = [
      "receipt-0",
      "receipt-1",
      "receipt-2",
      "receipt-3",
      "receipt-4",
      "receipt-5",
      "receipt-6",
    ];
    const hashes = payloads.map(leafHash);
    const leftPair = nodeHash(hashes[0], hashes[1]);
    const rightPair = nodeHash(hashes[4], hashes[5]);
    const rightThree = nodeHash(rightPair, hashes[6]);

    expect(getConsistencyProof(3, payloads).audit_path).toEqual([
      hashes[2],
      hashes[3],
      leftPair,
      rightThree,
    ]);
    expect(getConsistencyProof(4, payloads).audit_path).toEqual([rightThree]);
    expect(getConsistencyProof(6, payloads).audit_path).toEqual([
      rightPair,
      hashes[6],
      nodeHash(leftPair, nodeHash(hashes[2], hashes[3])),
    ]);
  });

  it("verifies consistency proofs as checkpoints grow", () => {
    const payloads = [
      "receipt-0",
      "receipt-1",
      "receipt-2",
      "receipt-3",
      "receipt-4",
      "receipt-5",
      "receipt-6",
    ];
    const newRootHash = computeMerkleRoot(payloads);

    for (const oldTreeSize of [1, 2, 3, 4, 5, 6]) {
      const proof = getConsistencyProof(oldTreeSize, payloads);
      const oldRootHash = computeMerkleRoot(payloads.slice(0, oldTreeSize));

      expect(
        verifyConsistencyProof({
          oldRootHash,
          newRootHash,
          proof,
        }),
      ).toBe(true);
    }
  });

  it("handles empty and unchanged consistency boundaries", () => {
    expect(
      verifyConsistencyProof({
        oldRootHash: EMPTY_TREE_ROOT,
        newRootHash: EMPTY_TREE_ROOT,
        proof: getConsistencyProof(0, []),
      }),
    ).toBe(true);
    expect(
      verifyConsistencyProof({
        oldRootHash: EMPTY_TREE_ROOT,
        newRootHash: computeMerkleRoot(["receipt-a"]),
        proof: getConsistencyProof(0, ["receipt-a"]),
      }),
    ).toBe(true);

    const payloads = ["receipt-a", "receipt-b"];
    const root = computeMerkleRoot(payloads);

    expect(
      verifyConsistencyProof({
        oldRootHash: root,
        newRootHash: root,
        proof: getConsistencyProof(payloads.length, payloads),
      }),
    ).toBe(true);
  });

  it("rejects tampered consistency proofs", () => {
    const payloads = ["receipt-0", "receipt-1", "receipt-2", "receipt-3"];
    const proof = getConsistencyProof(2, payloads);

    expect(
      verifyConsistencyProof({
        oldRootHash: computeMerkleRoot(payloads.slice(0, 2)),
        newRootHash: "a".repeat(64),
        proof,
      }),
    ).toBe(false);
    expect(
      verifyConsistencyProof({
        oldRootHash: computeMerkleRoot(payloads.slice(0, 2)),
        newRootHash: computeMerkleRoot(payloads),
        proof: {
          ...proof,
          audit_path: [...proof.audit_path, leafHash("extra")],
        },
      }),
    ).toBe(false);
    expect(
      verifyConsistencyProof({
        oldRootHash: computeMerkleRoot(payloads.slice(0, 2)),
        newRootHash: computeMerkleRoot(payloads),
        proof: {
          ...proof,
          old_tree_size: 5,
        },
      }),
    ).toBe(false);
  });

  it("rejects impossible consistency proof generation requests", () => {
    expect(() => getConsistencyProof(3, ["receipt-0", "receipt-1"])).toThrow(
      /less than or equal/i,
    );
  });
});
