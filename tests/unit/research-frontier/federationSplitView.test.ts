import { describe, expect, it } from "vitest";
import { computeMerkleRoot } from "../../../packages/research-frontier/src/merkle";
import {
  canonicalCheckpointPayload,
  createDevWitnessKeyPair,
  type DevWitnessKeyPair,
  signCheckpointPayload,
  type WitnessCheckpoint,
  type WitnessKeyManifest,
} from "../../../packages/research-frontier/src/witnessCheckpoint";
import {
  countValidWitnesses,
  detectFederationSplitView,
  detectSplitView,
  verifyFederationSplitViewProof,
} from "../../../packages/research-frontier/src/witnessFraudProof";

const W = [
  createDevWitnessKeyPair("fw-0"),
  createDevWitnessKeyPair("fw-1"),
  createDevWitnessKeyPair("fw-2"),
  createDevWitnessKeyPair("fw-3"),
];
const LOG = "ghost-ark-federation-log";

function manifestFor(members: DevWitnessKeyPair[]): WitnessKeyManifest {
  return {
    schema_version: "ghostark.research.witness_key_manifest.v1",
    generated_at: "2026-01-01T00:00:00Z",
    witnesses: members.map((w) => ({
      witness_id: w.witnessId,
      signature_algorithm: "ecdsa-p256-sha256",
      public_key_pem: w.publicKeyPem,
      valid_from: "2020-01-01T00:00:00Z",
      status: "ACTIVE",
    })),
  };
}

function checkpoint(payloads: string[], signers: DevWitnessKeyPair[], integratedTime = "2026-07-09T14:00:00Z"): WitnessCheckpoint {
  const unsigned = {
    schema_version: "ghostark.research.witness_checkpoint.v1" as const,
    log_id: LOG,
    tree_size: payloads.length,
    root_hash: computeMerkleRoot(payloads),
    integrated_time: integratedTime,
  };
  const payload = canonicalCheckpointPayload(unsigned);
  return {
    ...unsigned,
    witness_signatures: signers.map((s) => ({
      witness_id: s.witnessId,
      signature_algorithm: "ecdsa-p256-sha256",
      signature: signCheckpointPayload(payload, s.privateKeyPem),
    })),
  };
}

const manifest = manifestFor(W);

describe("federation-level split view (Phase II disjoint-signer fork)", () => {
  // Two conflicting heads at the same tree_size, each quorum-signed by a DISJOINT
  // witness pair. No single witness signed both, so single-witness detection is
  // blind to it.
  const headX = checkpoint(["a", "b"], [W[0], W[1]]);
  const headY = checkpoint(["c", "d"], [W[2], W[3]]);

  it("single-witness detection is blind to a disjoint-signer fork", () => {
    expect(detectSplitView([headX, headY], manifest)).toBeNull();
  });

  it("federation detection catches it and the proof verifies offline", () => {
    const proof = detectFederationSplitView([headX, headY], manifest, 2);
    expect(proof).not.toBeNull();
    expect(proof?.tree_size).toBe(2);
    expect(proof?.checkpoint_a.root_hash).not.toBe(proof?.checkpoint_b.root_hash);
    expect(verifyFederationSplitViewProof(proof!, manifest).valid).toBe(true);
  });

  it("does not fire when one head fails to reach quorum", () => {
    const underSigned = checkpoint(["c", "d"], [W[2]]); // only 1 valid witness
    expect(detectFederationSplitView([headX, underSigned], manifest, 2)).toBeNull();
  });

  it("does not fire when the conflicting heads have different tree sizes", () => {
    const bigger = checkpoint(["c", "d", "e"], [W[2], W[3]]); // tree_size 3
    expect(detectFederationSplitView([headX, bigger], manifest, 2)).toBeNull();
  });

  it("does not fire when heads agree on the root", () => {
    const sameAsX = checkpoint(["a", "b"], [W[2], W[3]]);
    expect(detectFederationSplitView([headX, sameAsX], manifest, 2)).toBeNull();
  });

  it("countValidWitnesses counts distinct valid signers only", () => {
    expect(countValidWitnesses(headX, manifest)).toBe(2);
    const outsider = createDevWitnessKeyPair("outsider");
    expect(countValidWitnesses(headX, manifestFor([W[0]]))).toBe(1); // W[1] not in manifest
    expect(countValidWitnesses(checkpoint(["a", "b"], [outsider]), manifest)).toBe(0);
  });
});
