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

// A realistic append-only ledger: the tree GROWS across epochs, so each epoch
// has a DISTINCT root. C40 holds 3 leaves; C43 holds those 3 plus 3 more.
const leavesC40: ReceiptChainHeadLeaf[] = [
  { tenantId: "acme-lab", headHash: "sha256:" + "a".repeat(64) },
  { tenantId: "beta-lab", headHash: "sha256:" + "b".repeat(64) },
  { tenantId: "gamma-lab", headHash: "sha256:" + "c".repeat(64) },
];
const postRevocationLeaf: ReceiptChainHeadLeaf = { tenantId: "zeta-lab", headHash: "sha256:" + "f".repeat(64) };
const leavesC43: ReceiptChainHeadLeaf[] = [
  ...leavesC40,
  { tenantId: "delta-lab", headHash: "sha256:" + "d".repeat(64) },
  { tenantId: "epsilon-lab", headHash: "sha256:" + "e".repeat(64) },
  postRevocationLeaf,
];

const rootC40 = merkleRootForLeaves(leavesC40);
const rootC43 = merkleRootForLeaves(leavesC43);

// A pre-revocation receipt: its leaf is genuinely in C40's tree.
const proofPre = buildMerkleInclusionProof(leavesC40, leavesC40[0]);
// A post-revocation receipt: its leaf appears ONLY in C43's tree (not in C40).
const proofPost = buildMerkleInclusionProof(leavesC43, postRevocationLeaf);

function sequence(): LedgerSequence {
  return {
    logId: "ghost-ark-receipts",
    epochs: [
      { epochId: "C40", index: 40, createdAt: "2026-07-09T12:00:00Z", merkleRoot: rootC40 },
      { epochId: "C41", index: 41, createdAt: "2026-07-09T13:00:00Z", merkleRoot: "sha256:" + "1".repeat(64) },
      { epochId: "C42", index: 42, createdAt: "2026-07-09T15:00:00Z", merkleRoot: "sha256:" + "2".repeat(64) },
      { epochId: "C43", index: 43, createdAt: "2026-07-09T16:00:00Z", merkleRoot: rootC43 },
    ],
  };
}

describe("ledger-anchored revocation", () => {
  it("accepts a receipt whose ledger position precedes the revocation epoch", () => {
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C40",
      inclusionProof: proofPre,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(true);
    expect(result.standing).toBe("valid_pre_revocation");
  });

  it("rejects a receipt whose leaf exists only in a post-revocation epoch", () => {
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "C43",
      inclusionProof: proofPost,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_post_revocation");
  });

  it("cannot backdate ledger position: a post-revocation leaf claimed at an earlier epoch is unprovable", () => {
    // The attacker holds a since-revoked key and tries to claim its receipt was
    // included at C40 (pre-revocation). But its leaf is not in C40's tree, so the
    // real proof (against rootC43) does not reconstruct C40's root.
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      receiptTimestamp: "2026-07-09T14:00:00Z", // clock claims pre-revocation
      inclusionEpochId: "C40",
      inclusionProof: proofPost, // real proof is against rootC43, not rootC40
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("flags backdating and still rejects when a post-revocation receipt carries a pre-revocation timestamp", () => {
    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      receiptTimestamp: "2026-07-09T14:00:00Z", // before C42 sealed at 15:00Z
      inclusionEpochId: "C43",
      inclusionProof: proofPost,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C42" },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_post_revocation");
    expect(result.backdatingSuspected).toBe(true);
  });

  it("the self-reported timestamp cannot change the verdict", () => {
    const base = { keyId: KEY, inclusionEpochId: "C43", inclusionProof: proofPost, sequence: sequence(), revocation: { keyId: KEY, revocationEpochId: "C42" } };
    const withoutTs = enforceLedgerAnchoredRevocation(base);
    const withBackdatedTs = enforceLedgerAnchoredRevocation({ ...base, receiptTimestamp: "2020-01-01T00:00:00Z" });
    expect(withoutTs.verdict).toBe(withBackdatedTs.verdict);
    expect(withBackdatedTs.verdict).toBe(false);
  });

  it("fails closed on a tampered inclusion proof", () => {
    const tampered = buildMerkleInclusionProof(leavesC40, leavesC40[0]);
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
      inclusionProof: proofPre,
      sequence: sequence(),
      revocation: { keyId: KEY, revocationEpochId: "C99" },
    });
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("rejects a non-monotonic ledger sequence", () => {
    const bad: LedgerSequence = {
      logId: "ghost-ark-receipts",
      epochs: [
        { epochId: "C1", index: 5, createdAt: "2026-07-09T13:00:00Z", merkleRoot: rootC40 },
        { epochId: "C2", index: 4, createdAt: "2026-07-09T14:00:00Z", merkleRoot: rootC40 },
      ],
    };
    expect(() => assertMonotonicLedgerSequence(bad)).toThrow();
  });
});

// CHARACTERIZATION TEST (exploit E1 — fabricated ledger bypass).
//
// This documents WHY enforceLedgerAnchoredRevocation is NON-AUTHORITATIVE: its
// `sequence` argument is unauthenticated, so a caller who controls no keys can
// still mint a `valid_pre_revocation` verdict. This is expected, checked-in
// evidence of the weakness — NOT an endorsement. The authenticated replacement
// (enforceAuthenticatedLedgerRevocation, research-frontier) rejects the same
// attack as `rejected_unauthenticated`.
describe("ledger-anchored revocation — E1 fabricated-ledger weakness (characterization)", () => {
  it("accepts a fully fabricated sequence, proving ordering is caller-controlled", () => {
    // A since-revoked key holder mints a fresh receipt (its chain-head leaf) and
    // fabricates an entire ledger around it: an "inclusion" epoch at a low index
    // holding the attacker's own tree root, and a "revocation" epoch at a higher
    // index. Nothing here is signed or witnessed.
    const attackerLeaf: ReceiptChainHeadLeaf = { tenantId: "attacker", headHash: "sha256:" + "7".repeat(64) };
    const forgedRoot = merkleRootForLeaves([attackerLeaf]);
    const forgedProof = buildMerkleInclusionProof([attackerLeaf], attackerLeaf);
    const fabricated: LedgerSequence = {
      logId: "totally-made-up-log",
      epochs: [
        { epochId: "FAKE_INCL", index: 10, createdAt: "2001-01-01T00:00:00Z", merkleRoot: forgedRoot },
        { epochId: "FAKE_REVOC", index: 20, createdAt: "2001-01-02T00:00:00Z", merkleRoot: "sha256:" + "3".repeat(64) },
      ],
    };

    const result = enforceLedgerAnchoredRevocation({
      keyId: KEY,
      inclusionEpochId: "FAKE_INCL",
      inclusionProof: forgedProof,
      sequence: fabricated,
      revocation: { keyId: KEY, revocationEpochId: "FAKE_REVOC" },
    });

    // The unauthenticated path is fooled. This is the defect, made executable.
    expect(result.verdict).toBe(true);
    expect(result.standing).toBe("valid_pre_revocation");
  });
});
