import { describe, expect, it } from "vitest";
import {
  buildMerkleInclusionProof,
  merkleRootForLeaves,
  type ReceiptChainHeadLeaf,
} from "../../../../packages/enforcement-runtime/src/receipts/checkpoint";
import {
  assertMonotonicLedgerSequence,
  enforceLedgerAnchoredRevocation,
  type LedgerSequence,
} from "../../../../packages/enforcement-runtime/src/receipts/ledgerAnchoredRevocation";

const KEY = "arn:aws:kms:us-east-1:000000000000:key/aa11bb22-cc33-4d44-9e55-ff66aa77bb88";

const leaves: ReceiptChainHeadLeaf[] = [
  { tenantId: "acme-lab", headHash: "sha256:" + "a".repeat(64) },
  { tenantId: "beta-lab", headHash: "sha256:" + "b".repeat(64) },
  { tenantId: "gamma-lab", headHash: "sha256:" + "c".repeat(64) },
];

const inclusionRoot = merkleRootForLeaves(leaves);
const inclusionProof = buildMerkleInclusionProof(leaves, leaves[0]);

function sequence(): LedgerSequence {
  return {
    logId: "ghost-ark-receipts",
    epochs: [
      { epochId: "C40", index: 40, createdAt: "2026-07-09T12:00:00Z", merkleRoot: inclusionRoot },
      { epochId: "C41", index: 41, createdAt: "2026-07-09T13:00:00Z", merkleRoot: "sha256:" + "1".repeat(64) },
      { epochId: "C42", index: 42, createdAt: "2026-07-09T15:00:00Z", merkleRoot: "sha256:" + "2".repeat(64) },
      { epochId: "C43", index: 43, createdAt: "2026-07-09T16:00:00Z", merkleRoot: "sha256:" + "3".repeat(64) },
    ],
  };
}

describe("ledger-anchored revocation", () => {
  it("accepts a receipt whose ledger position precedes the revocation epoch", () => {
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C40",
      inclusionProof,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(true);
    expect(result.standing).toBe("valid_pre_revocation");
    expect(result.inclusionIndex).toBe(40);
    expect(result.revocationIndex).toBe(42);
  });

  it("rejects a receipt committed at or after the revocation epoch", () => {
    const proofAt43 = buildMerkleInclusionProof(leaves, leaves[1]);
    const seq = sequence();
    seq.epochs[3].merkleRoot = merkleRootForLeaves(leaves); // C43 root == leaves root
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C43",
      inclusionProof: proofAt43,
      sequence: seq,
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_post_revocation");
  });

  it("neutralizes the fixture-C backdating attack and flags it", () => {
    // Attacker holds a key revoked at epoch C42 (sealed 15:00Z). They mint a
    // fresh receipt, stamp it 14:00Z, but the log only includes it at C43.
    const proofAt43 = buildMerkleInclusionProof(leaves, leaves[2]);
    const seq = sequence();
    seq.epochs[3].merkleRoot = merkleRootForLeaves(leaves);
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      receiptTimestamp: "2026-07-09T14:00:00Z", // claims pre-revocation
      inclusionEpochId: "C43",
      inclusionProof: proofAt43,
      sequence: seq,
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_post_revocation");
    expect(result.backdatingSuspected).toBe(true);
    expect(result.checks.find((c) => c.name === "backdating_detector")?.passed).toBe(false);
  });

  it("the self-reported timestamp cannot change the verdict", () => {
    const proofAt43 = buildMerkleInclusionProof(leaves, leaves[0]);
    const seq = sequence();
    seq.epochs[3].merkleRoot = merkleRootForLeaves(leaves);
    const withoutTs = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C43",
      inclusionProof: proofAt43,
      sequence: seq,
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    const withBackdatedTs = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      receiptTimestamp: "2020-01-01T00:00:00Z",
      inclusionEpochId: "C43",
      inclusionProof: proofAt43,
      sequence: seq,
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(withoutTs.verdict).toBe(withBackdatedTs.verdict);
    expect(withBackdatedTs.verdict).toBe(false);
  });

  it("fails closed on a tampered inclusion proof", () => {
    const tampered = buildMerkleInclusionProof(leaves, leaves[0]);
    tampered.proof[0] = { position: tampered.proof[0].position, hash: "sha256:" + "9".repeat(64) };
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C40",
      inclusionProof: tampered,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("fails closed when the revocation epoch is unknown to the ledger", () => {
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C40",
      inclusionProof,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C99" },
    });
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("rejects a non-monotonic ledger sequence", () => {
    const bad: LedgerSequence = {
      logId: "ghost-ark-receipts",
      epochs: [
        { epochId: "C1", index: 5, createdAt: "2026-07-09T13:00:00Z", merkleRoot: inclusionRoot },
        { epochId: "C2", index: 4, createdAt: "2026-07-09T14:00:00Z", merkleRoot: inclusionRoot },
      ],
    };
    expect(() => assertMonotonicLedgerSequence(bad)).toThrow();
  });
});
