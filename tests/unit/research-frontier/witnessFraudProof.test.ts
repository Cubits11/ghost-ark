import { describe, expect, it } from "vitest";
import {
  createDevWitnessKeyPair,
  createWitnessCheckpoint,
  type WitnessCheckpoint,
  type WitnessKeyManifest,
} from "../../../packages/research-frontier/src/witnessCheckpoint";
import {
  detectSplitView,
  verifySplitViewFraudProof,
  splitViewFraudProofSchemaVersion,
  type SplitViewFraudProof,
} from "../../../packages/research-frontier/src/witnessFraudProof";

const witness = createDevWitnessKeyPair("witness-alpha");

function manifest(): WitnessKeyManifest {
  return {
    schema_version: "ghostark.research.witness_key_manifest.v1",
    generated_at: "2026-07-09T00:00:00Z",
    witnesses: [
      {
        witness_id: witness.witnessId,
        signature_algorithm: "ecdsa-p256-sha256",
        public_key_pem: witness.publicKeyPem,
        valid_from: "2026-07-01T00:00:00Z",
        status: "ACTIVE",
      },
    ],
  };
}

// Two heads of the SAME log at the SAME tree_size but DIFFERENT payload sets ->
// different roots. The witness signs both. That pair is an equivocation.
const integratedTime = "2026-07-09T14:00:00Z";
const viewToAuditor = createWitnessCheckpoint({
  logId: "ghost-ark-receipts",
  receiptPayloads: ["r1", "r2", "r3"],
  integratedTime,
  witness,
});
const viewToUser = createWitnessCheckpoint({
  logId: "ghost-ark-receipts",
  receiptPayloads: ["r1", "r2", "EVIL"],
  integratedTime,
  witness,
});

describe("witness split-view fraud proofs", () => {
  it("detects an equivocation across two conflicting signed heads", () => {
    const proof = detectSplitView([viewToAuditor, viewToUser], manifest());
    expect(proof).not.toBeNull();
    expect(proof?.witness_id).toBe(witness.witnessId);
    expect(proof?.tree_size).toBe(3);
    expect(proof?.checkpoint_a.root_hash).not.toBe(proof?.checkpoint_b.root_hash);
  });

  it("verifies a genuine fraud proof offline against the witness key", () => {
    const proof = detectSplitView([viewToAuditor, viewToUser], manifest())!;
    const result = verifySplitViewFraudProof(proof, manifest());
    expect(result.valid).toBe(true);
    expect(result.checks.find((c) => c.name === "roots_differ")?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === "signature_a")?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === "signature_b")?.passed).toBe(true);
  });

  it("finds no equivocation when heads agree", () => {
    const sameAgain = createWitnessCheckpoint({
      logId: "ghost-ark-receipts",
      receiptPayloads: ["r1", "r2", "r3"],
      integratedTime,
      witness,
    });
    expect(detectSplitView([viewToAuditor, sameAgain], manifest())).toBeNull();
  });

  it("rejects a forged fraud proof whose signatures do not verify", () => {
    const forged: SplitViewFraudProof = {
      schema_version: splitViewFraudProofSchemaVersion,
      log_id: "ghost-ark-receipts",
      witness_id: witness.witnessId,
      tree_size: 3,
      checkpoint_a: viewToAuditor,
      checkpoint_b: {
        ...viewToUser,
        // Tamper the root without re-signing: signature over payload no longer matches.
        root_hash: "sha256:" + "f".repeat(64),
      } as WitnessCheckpoint,
    };
    expect(verifySplitViewFraudProof(forged, manifest()).valid).toBe(false);
  });

  it("rejects a 'fraud proof' whose two heads are actually identical", () => {
    const notFraud: SplitViewFraudProof = {
      schema_version: splitViewFraudProofSchemaVersion,
      log_id: "ghost-ark-receipts",
      witness_id: witness.witnessId,
      tree_size: 3,
      checkpoint_a: viewToAuditor,
      checkpoint_b: viewToAuditor,
    };
    const result = verifySplitViewFraudProof(notFraud, manifest());
    expect(result.valid).toBe(false);
    expect(result.checks.find((c) => c.name === "roots_differ")?.passed).toBe(false);
  });
});
