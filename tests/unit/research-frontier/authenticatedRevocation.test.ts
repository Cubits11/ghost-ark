import { describe, expect, it } from "vitest";
import {
  computeMerkleRoot,
  getConsistencyProof,
  getInclusionProof,
} from "../../../packages/research-frontier/src/merkle";
import {
  canonicalCheckpointPayload,
  createDevWitnessKeyPair,
  type DevWitnessKeyPair,
  signCheckpointPayload,
  type WitnessCheckpoint,
  type WitnessKeyManifest,
} from "../../../packages/research-frontier/src/witnessCheckpoint";
import {
  canonicalRevocationRecordPayload,
  countQuorumWitnesses,
  enforceAuthenticatedLedgerRevocation,
  ledgerRevocationRecordSchemaVersion,
  MATURITY,
} from "../../../packages/research-frontier/src/authenticatedRevocation";

const KEY = "arn:aws:kms:us-east-1:000000000000:key/aa11bb22-cc33-4d44-9e55-ff66aa77bb88";
const LOG = "ghost-ark-transparency-log";

// Witnesses are expensive to generate; create them once and reuse across cases.
const witnesses: DevWitnessKeyPair[] = [
  createDevWitnessKeyPair("witness-alpha"),
  createDevWitnessKeyPair("witness-bravo"),
  createDevWitnessKeyPair("witness-charlie"),
];
const evilWitness = createDevWitnessKeyPair("witness-evil");

function manifestFor(members: DevWitnessKeyPair[]): WitnessKeyManifest {
  return {
    schema_version: "ghostark.research.witness_key_manifest.v1",
    generated_at: "2026-01-01T00:00:00Z",
    witnesses: members.map((witness) => ({
      witness_id: witness.witnessId,
      signature_algorithm: "ecdsa-p256-sha256",
      public_key_pem: witness.publicKeyPem,
      valid_from: "2020-01-01T00:00:00Z",
      status: "ACTIVE",
    })),
  };
}

function signedCheckpoint(params: {
  logId: string;
  payloads: string[];
  integratedTime: string;
  signers: DevWitnessKeyPair[];
}): WitnessCheckpoint {
  const unsigned = {
    schema_version: "ghostark.research.witness_checkpoint.v1" as const,
    log_id: params.logId,
    tree_size: params.payloads.length,
    root_hash: computeMerkleRoot(params.payloads),
    integrated_time: params.integratedTime,
  };
  const payload = canonicalCheckpointPayload(unsigned);
  return {
    ...unsigned,
    witness_signatures: params.signers.map((signer) => ({
      witness_id: signer.witnessId,
      signature_algorithm: "ecdsa-p256-sha256",
      signature: signCheckpointPayload(payload, signer.privateKeyPem),
    })),
  };
}

const RECEIPT_LEAF = "ghost-ark.receipt-chain-head::acme-lab::sha256:" + "a".repeat(64);
const REVOCATION_LEAF = canonicalRevocationRecordPayload({
  schema_version: ledgerRevocationRecordSchemaVersion,
  type: "key_revocation",
  key_id: KEY,
});

const trustRoot = manifestFor(witnesses);

/** A single-checkpoint log with the receipt at `receiptIndex` and the revocation
 *  record at `revocationIndex`, both witnessed by the full quorum. */
function singleCheckpointScenario(receiptIndex: number, revocationIndex: number) {
  const size = Math.max(receiptIndex, revocationIndex) + 2;
  const payloads: string[] = [];
  for (let i = 0; i < size; i += 1) {
    if (i === receiptIndex) payloads.push(RECEIPT_LEAF);
    else if (i === revocationIndex) payloads.push(REVOCATION_LEAF);
    else payloads.push(`filler-leaf-${i}`);
  }
  const checkpoint = signedCheckpoint({
    logId: LOG,
    payloads,
    integratedTime: "2026-07-09T16:00:00Z",
    signers: witnesses,
  });
  return {
    keyId: KEY,
    trustRoot,
    witnessQuorum: 3,
    inclusion: {
      checkpoint,
      leafPayload: RECEIPT_LEAF,
      proof: getInclusionProof(receiptIndex, payloads),
    },
    revocation: {
      keyId: KEY,
      checkpoint,
      leafPayload: REVOCATION_LEAF,
      proof: getInclusionProof(revocationIndex, payloads),
    },
    consistency: getConsistencyProof(payloads.length, payloads),
  } as const;
}

describe("authenticated ledger revocation — honest paths", () => {
  it("MATURITY is RESEARCH (not yet a production authority)", () => {
    expect(MATURITY).toBe("RESEARCH");
  });

  it("accepts a receipt whose authenticated position precedes the revocation record", () => {
    const result = enforceAuthenticatedLedgerRevocation(singleCheckpointScenario(1, 3));
    expect(result.verdict).toBe(true);
    expect(result.standing).toBe("valid_pre_revocation");
    expect(result.receiptLeafIndex).toBe(1);
    expect(result.revocationLeafIndex).toBe(3);
  });

  it("rejects a receipt whose authenticated position is at or after revocation", () => {
    const result = enforceAuthenticatedLedgerRevocation(singleCheckpointScenario(4, 2));
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_post_revocation");
  });

  it("accepts across two checkpoints bound by a consistency proof (receipt in prefix)", () => {
    const prefix = ["r0", RECEIPT_LEAF];
    const full = ["r0", RECEIPT_LEAF, "r2", REVOCATION_LEAF];
    const inclusionCp = signedCheckpoint({ logId: LOG, payloads: prefix, integratedTime: "2026-07-09T12:00:00Z", signers: witnesses });
    const revocationCp = signedCheckpoint({ logId: LOG, payloads: full, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint: inclusionCp, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(1, prefix) },
      revocation: { keyId: KEY, checkpoint: revocationCp, leafPayload: REVOCATION_LEAF, proof: getInclusionProof(3, full) },
      consistency: getConsistencyProof(prefix.length, full),
    });
    expect(result.standing).toBe("valid_pre_revocation");
  });
});

describe("authenticated ledger revocation — E1 fabricated-ledger closure", () => {
  it("fails closed when the checkpoints are signed by a witness OUTSIDE the trust root", () => {
    // The original E1: an attacker with no witness keys fabricates the ledger.
    // Here the fabricated log is signed by `evilWitness`, absent from trustRoot.
    const payloads = ["r0", "r1", REVOCATION_LEAF, RECEIPT_LEAF]; // receipt at 3, AFTER revocation at 2
    const forged = signedCheckpoint({ logId: LOG, payloads, integratedTime: "2026-07-09T16:00:00Z", signers: [evilWitness] });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      receiptTimestamp: "2020-01-01T00:00:00Z",
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint: forged, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(3, payloads) },
      revocation: { keyId: KEY, checkpoint: forged, leafPayload: REVOCATION_LEAF, proof: getInclusionProof(2, payloads) },
      consistency: getConsistencyProof(payloads.length, payloads),
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_unauthenticated");
  });

  it("fails closed on a fabricated inclusion PROOF against an authentic root", () => {
    const scenario = singleCheckpointScenario(4, 2); // genuinely post-revocation
    // Attacker keeps the authentic (quorum-signed) checkpoint but forges a proof
    // claiming the receipt sits at index 0 (pre-revocation).
    const forgedProof = { ...scenario.inclusion.proof, leaf_index: 0 };
    const result = enforceAuthenticatedLedgerRevocation({
      ...scenario,
      inclusion: { ...scenario.inclusion, proof: forgedProof },
    });
    expect(result.verdict).toBe(false);
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("the self-reported timestamp cannot change the verdict and backdating is flagged", () => {
    const base = singleCheckpointScenario(4, 2); // post-revocation
    const withoutTs = enforceAuthenticatedLedgerRevocation(base);
    const backdated = enforceAuthenticatedLedgerRevocation({ ...base, receiptTimestamp: "2020-01-01T00:00:00Z" });
    expect(withoutTs.verdict).toBe(false);
    expect(backdated.verdict).toBe(false);
    expect(backdated.backdatingSuspected).toBe(true);
  });
});

describe("authenticated ledger revocation — fail-closed on every unauthenticated input", () => {
  it("rejects a sub-quorum checkpoint", () => {
    const payloads = ["r0", RECEIPT_LEAF, "r2", REVOCATION_LEAF];
    const underSigned = signedCheckpoint({ logId: LOG, payloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses.slice(0, 2) });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint: underSigned, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(1, payloads) },
      revocation: { keyId: KEY, checkpoint: underSigned, leafPayload: REVOCATION_LEAF, proof: getInclusionProof(3, payloads) },
      consistency: getConsistencyProof(payloads.length, payloads),
    });
    expect(result.standing).toBe("rejected_unauthenticated");
  });

  it("rejects a tampered inclusion audit path", () => {
    const scenario = singleCheckpointScenario(1, 3);
    const tampered = {
      ...scenario.inclusion.proof,
      audit_path: scenario.inclusion.proof.audit_path.map((step, index) =>
        index === 0 ? { ...step, hash: "f".repeat(64) } : step,
      ),
    };
    const result = enforceAuthenticatedLedgerRevocation({
      ...scenario,
      inclusion: { ...scenario.inclusion, proof: tampered },
    });
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("rejects checkpoints from different logs", () => {
    const payloads = ["r0", RECEIPT_LEAF, "r2", REVOCATION_LEAF];
    const inclusionCp = signedCheckpoint({ logId: LOG, payloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    const otherCp = signedCheckpoint({ logId: "some-other-log", payloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint: inclusionCp, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(1, payloads) },
      revocation: { keyId: KEY, checkpoint: otherCp, leafPayload: REVOCATION_LEAF, proof: getInclusionProof(3, payloads) },
      consistency: getConsistencyProof(payloads.length, payloads),
    });
    expect(result.standing).toBe("rejected_unauthenticated");
  });

  it("rejects a revocation leaf that is not the canonical record for the signing key", () => {
    // Committed leaf is a revocation record for a DIFFERENT key.
    const otherKeyRecord = canonicalRevocationRecordPayload({
      schema_version: ledgerRevocationRecordSchemaVersion,
      type: "key_revocation",
      key_id: "arn:aws:kms:us-east-1:000000000000:key/deadbeef-0000-4000-8000-000000000000",
    });
    const payloads = ["r0", RECEIPT_LEAF, "r2", otherKeyRecord];
    const checkpoint = signedCheckpoint({ logId: LOG, payloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(1, payloads) },
      revocation: { keyId: KEY, checkpoint, leafPayload: otherKeyRecord, proof: getInclusionProof(3, payloads) },
      consistency: getConsistencyProof(payloads.length, payloads),
    });
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("rejects when the consistency proof does not bind the two checkpoints", () => {
    const inclusionPayloads = ["x", RECEIPT_LEAF];
    const revocationPayloads = ["a", "b", "c", REVOCATION_LEAF]; // NOT an extension of inclusionPayloads
    const inclusionCp = signedCheckpoint({ logId: LOG, payloads: inclusionPayloads, integratedTime: "2026-07-09T12:00:00Z", signers: witnesses });
    const revocationCp = signedCheckpoint({ logId: LOG, payloads: revocationPayloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    const result = enforceAuthenticatedLedgerRevocation({
      keyId: KEY,
      trustRoot,
      witnessQuorum: 3,
      inclusion: { checkpoint: inclusionCp, leafPayload: RECEIPT_LEAF, proof: getInclusionProof(1, inclusionPayloads) },
      revocation: { keyId: KEY, checkpoint: revocationCp, leafPayload: REVOCATION_LEAF, proof: getInclusionProof(3, revocationPayloads) },
      consistency: getConsistencyProof(inclusionPayloads.length, revocationPayloads),
    });
    expect(result.standing).toBe("rejected_unprovable");
  });

  it("rejects a revocation record whose key does not match the signing key (scope)", () => {
    const scenario = singleCheckpointScenario(1, 3);
    const result = enforceAuthenticatedLedgerRevocation({
      ...scenario,
      revocation: { ...scenario.revocation, keyId: "arn:aws:kms:us-east-1:000000000000:key/00000000-0000-4000-8000-000000000000" },
    });
    expect(result.standing).toBe("rejected_unprovable");
  });
});

describe("authenticated ledger revocation — ordering is EXACTLY authenticated index order", () => {
  it("exhaustively: verdict === (receiptIndex < revocationIndex) for all distinct positions", () => {
    const N = 6;
    for (let receiptIndex = 0; receiptIndex < N; receiptIndex += 1) {
      for (let revocationIndex = 0; revocationIndex < N; revocationIndex += 1) {
        if (receiptIndex === revocationIndex) continue;
        const result = enforceAuthenticatedLedgerRevocation(
          singleCheckpointScenario(receiptIndex, revocationIndex),
        );
        expect(result.verdict).toBe(receiptIndex < revocationIndex);
        expect(result.standing).toBe(
          receiptIndex < revocationIndex ? "valid_pre_revocation" : "rejected_post_revocation",
        );
      }
    }
  });
});

describe("countQuorumWitnesses", () => {
  it("counts distinct valid witnesses and ignores duplicates and outsiders", () => {
    const payloads = ["r0", "r1"];
    const cp = signedCheckpoint({ logId: LOG, payloads, integratedTime: "2026-07-09T16:00:00Z", signers: witnesses });
    // Append a duplicate of witness-alpha and an outsider evil signature.
    const payload = canonicalCheckpointPayload({
      schema_version: cp.schema_version,
      log_id: cp.log_id,
      tree_size: cp.tree_size,
      root_hash: cp.root_hash,
      integrated_time: cp.integrated_time,
    });
    const withNoise: WitnessCheckpoint = {
      ...cp,
      witness_signatures: [
        ...cp.witness_signatures,
        { witness_id: "witness-alpha", signature_algorithm: "ecdsa-p256-sha256", signature: signCheckpointPayload(payload, witnesses[0].privateKeyPem) },
        { witness_id: "witness-evil", signature_algorithm: "ecdsa-p256-sha256", signature: signCheckpointPayload(payload, evilWitness.privateKeyPem) },
      ],
    };
    expect(countQuorumWitnesses(withNoise, trustRoot)).toBe(3);
  });
});
