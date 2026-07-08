import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { LocalDevRuntimeAttester } from "../../../packages/enforcement-runtime/src/attestation/localRuntimeAttestation";
import { RuntimeAttestationPolicy, RuntimeIdentity } from "../../../packages/enforcement-runtime/src/attestation/runtimeAttestation";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest,
  signedDecisionReceiptHash
} from "../../../packages/enforcement-runtime/src/receipts/canonical";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../packages/enforcement-runtime/src/receipts/signer";
import { createLocalReceiptProof } from "../../../packages/enforcement-runtime/src/proofs/localReceiptProof";
import { ReceiptProofClaims, ReceiptProofPublicInputs, receiptProofStatementDigest } from "../../../packages/enforcement-runtime/src/proofs/receiptProof";

const issuedAt = "2026-07-08T12:00:00.000Z";
const secret = "runtime-attestation-secret";

const runtime: RuntimeIdentity = {
  runtimeId: "runtime-dev-a",
  imageDigest: `sha256:${"a".repeat(64)}`,
  codeDigest: `sha256:${"b".repeat(64)}`,
  policyCompilerDigest: `sha256:${"c".repeat(64)}`
};

const policy: RuntimeAttestationPolicy = {
  schemaVersion: "ghost.runtime_attestation_policy.v1",
  allowedTypes: ["local-dev-attestation"],
  requiredRuntimeIds: [runtime.runtimeId],
  allowedImageDigests: [runtime.imageDigest],
  allowedCodeDigests: [runtime.codeDigest],
  allowedPolicyCompilerDigests: [runtime.policyCompilerDigest],
  requireBindingToReceipt: true
};

const proofInputs: ReceiptProofPublicInputs = {
  tenantIdHash: `sha256:${"1".repeat(64)}`,
  chainHeadHash: `sha256:${"2".repeat(64)}`,
  epochId: "epoch-2026-07-08T12",
  checkpointDigest: `sha256:${"3".repeat(64)}`,
  merkleRoot: `sha256:${"4".repeat(64)}`,
  receiptCount: 1,
  keyManifestDigest: `sha256:${"5".repeat(64)}`
};

const proofClaims: ReceiptProofClaims = {
  receiptSignaturesValid: true,
  receiptChainLinksValid: true,
  tenantConstantAcrossChain: true,
  checkpointIncludesChainHead: true,
  keyManifestEpochsValid: true
};

function fixtureDir(): string {
  return mkdtempSync(path.join(tmpdir(), "ghost-ark-phase567-"));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

function runGhostVerify(args: readonly string[]) {
  return spawnSync(process.execPath, ["tools/ghost-verify.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function decisionReceipt() {
  const signer = new LocalDevHmacReceiptSigner({ secret: "chain-secret" });
  return signDecisionReceipt(
    buildUnsignedDecisionReceipt({
      request_id: "request-a",
      tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
      user_id_hash: privateHmacDigest("secret", "user-a"),
      session_id_hash: privateHmacDigest("secret", "session-a"),
      timestamp: issuedAt,
      model_id: "anthropic.claude-test",
      policy_version: "organization:org@1",
      policy_hash: "b".repeat(64),
      input_digest: publicSha256Digest("request-a"),
      retrieved_context_digests: [],
      decision_pre: "ALLOW",
      decision_post: "ALLOW",
      action_taken: ["emit_receipt"],
      risk_score: 0,
      consent_state: "not_required",
      memory_written: false,
      latency_ms: 1,
      cost_estimate_usd: 0,
      prev_receipt_hash: null,
      signature_alg: signer.algorithm
    }),
    signer
  );
}

describe("phase 5/6/7 standalone verifier wiring", () => {
  it("verifies local-dev runtime attestations through ghost-verify", () => {
    const dir = fixtureDir();
    const attestation = new LocalDevRuntimeAttester({ secret }).attest({
      runtime,
      binding: { receiptHash: `sha256:${"9".repeat(64)}` },
      issuedAt
    });
    const attestationPath = writeJson(dir, "attestation.json", attestation);
    const policyPath = writeJson(dir, "policy.json", policy);

    const result = runGhostVerify([
      "--runtime-attestation",
      attestationPath,
      "--attestation-policy",
      policyPath,
      "--attestation-secret",
      secret
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS runtime_attestation_signature");
    expect(result.stdout).toContain("VERDICT: PASS");
  });

  it("verifies attested receipt sidecar bundles through ghost-verify", () => {
    const dir = fixtureDir();
    const receipt = decisionReceipt();
    const attestation = new LocalDevRuntimeAttester({ secret }).attest({
      runtime,
      binding: { receiptHash: signedDecisionReceiptHash(receipt) },
      issuedAt
    });
    const bundlePath = writeJson(dir, "bundle.json", {
      schemaVersion: "ghost.attested_receipt_bundle.v1",
      receipt,
      attestation
    });
    const policyPath = writeJson(dir, "policy.json", policy);

    const result = runGhostVerify([
      "--attested-receipt-bundle",
      bundlePath,
      "--attestation-policy",
      policyPath,
      "--attestation-secret",
      secret
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS attested_receipt_bundle_schema");
    expect(result.stdout).toContain("PASS runtime_attestation_receipt_binding");
  });

  it("verifies local receipt proofs and fails closed for reserved proof systems", () => {
    const dir = fixtureDir();
    const localProof = createLocalReceiptProof({
      publicInputs: proofInputs,
      claims: proofClaims,
      transcriptWitnessDigest: `sha256:${"6".repeat(64)}`
    });
    const localProofPath = writeJson(dir, "local-proof.json", localProof);
    const unsupportedProofPath = writeJson(dir, "unsupported-proof.json", {
      schemaVersion: "ghost.receipt_proof.v1",
      proofSystem: "halo2",
      statement: {
        schemaVersion: "ghost.receipt_proof_statement.v1",
        proofSystem: "halo2",
        publicInputs: proofInputs,
        claims: proofClaims,
        statementDigest: receiptProofStatementDigest({ proofSystem: "halo2", publicInputs: proofInputs, claims: proofClaims })
      },
      proof: { proofBytesBase64: "AA==" }
    });

    const pass = runGhostVerify(["--receipt-proof", localProofPath]);
    const fail = runGhostVerify(["--receipt-proof", unsupportedProofPath]);

    expect(pass.status).toBe(0);
    expect(pass.stdout).toContain("PASS receipt_proof_local_transcript_digest");
    expect(fail.status).toBe(1);
    expect(fail.stdout).toContain("FAIL receipt_proof_backend");
  });
});
