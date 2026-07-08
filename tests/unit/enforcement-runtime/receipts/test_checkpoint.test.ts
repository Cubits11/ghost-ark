import { describe, expect, it } from "vitest";
import {
  buildMerkleInclusionProof,
  buildUnsignedEpochCheckpoint,
  signEpochCheckpoint,
  verifyEpochCheckpoint,
  verifyMerkleInclusionProof
} from "../../../../packages/enforcement-runtime/src/receipts/checkpoint";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";

const leaves = [
  { tenantId: "hmac-sha256:" + "b".repeat(64), headHash: "sha256:" + "2".repeat(64) },
  { tenantId: "hmac-sha256:" + "a".repeat(64), headHash: "sha256:" + "1".repeat(64) },
  { tenantId: "hmac-sha256:" + "c".repeat(64), headHash: "sha256:" + "3".repeat(64) }
];

describe("receipt epoch checkpoints", () => {
  it("builds deterministic Merkle roots independent of input order", () => {
    const first = buildUnsignedEpochCheckpoint({
      epochId: "epoch-2026-07-08T00",
      createdAt: "2026-07-08T00:00:00.000Z",
      leaves
    });
    const second = buildUnsignedEpochCheckpoint({
      epochId: "epoch-2026-07-08T00",
      createdAt: "2026-07-08T00:00:00.000Z",
      leaves: [...leaves].reverse()
    });

    expect(first).toEqual(second);
    expect(first.merkleRoot).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.leafCount).toBe(3);
  });

  it("verifies and rejects Merkle inclusion proofs", () => {
    const proof = buildMerkleInclusionProof(leaves, leaves[1]);

    expect(verifyMerkleInclusionProof(proof)).toBe(true);
    expect(
      verifyMerkleInclusionProof({
        ...proof,
        leaf: { ...proof.leaf, headHash: "sha256:" + "9".repeat(64) }
      })
    ).toBe(false);
  });

  it("signs epoch checkpoints with the dedicated signer interface", async () => {
    const signer = new LocalDevHmacReceiptSigner({ keyId: "epoch-local-key", secret: "checkpoint-secret" });
    const checkpoint = await signEpochCheckpoint({
      epochId: "epoch-2026-07-08T00",
      createdAt: "2026-07-08T00:00:00.000Z",
      leaves,
      signer
    });
    const result = await verifyEpochCheckpoint(checkpoint, signer);

    expect(result.verdict).toBe(true);
    expect(checkpoint.signerKeyId).toBe("epoch-local-key");
  });
});
