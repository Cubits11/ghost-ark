import { describe, expect, it } from "vitest";
import { createLocalReceiptProof } from "../../../packages/enforcement-runtime/src/proofs/localReceiptProof";
import {
  ReceiptProof,
  ReceiptProofBackendVerifier,
  ReceiptProofClaims,
  ReceiptProofPublicInputs,
  privateReceiptProofBundleWarning,
  receiptProofStatementDigest,
  verifyReceiptProof
} from "../../../packages/enforcement-runtime/src/proofs/receiptProof";

const publicInputs: ReceiptProofPublicInputs = {
  tenantIdHash: `sha256:${"1".repeat(64)}`,
  chainHeadHash: `sha256:${"2".repeat(64)}`,
  epochId: "epoch-2026-07-08T12",
  checkpointDigest: `sha256:${"3".repeat(64)}`,
  merkleRoot: `sha256:${"4".repeat(64)}`,
  receiptCount: 2,
  keyManifestDigest: `sha256:${"5".repeat(64)}`
};

const claims: ReceiptProofClaims = {
  receiptSignaturesValid: true,
  receiptChainLinksValid: true,
  tenantConstantAcrossChain: true,
  checkpointIncludesChainHead: true,
  keyManifestEpochsValid: true
};

function localProof(): ReceiptProof {
  return createLocalReceiptProof({
    publicInputs,
    claims,
    transcriptWitnessDigest: `sha256:${"6".repeat(64)}`
  });
}

function risc0Proof(overrides: Partial<ReceiptProof["proof"]> = {}): ReceiptProof {
  return {
    schemaVersion: "ghost.receipt_proof.v1",
    proofSystem: "risc0",
    statement: {
      schemaVersion: "ghost.receipt_proof_statement.v1",
      proofSystem: "risc0",
      publicInputs,
      claims,
      statementDigest: receiptProofStatementDigest({ proofSystem: "risc0", publicInputs, claims })
    },
    proof: { proofBytesBase64: "AA==", ...overrides }
  };
}

const risc0Verifier: ReceiptProofBackendVerifier = {
  supportedProofSystems: ["risc0"],
  verify: () => ({
    passed: true,
    detail: "External RISC Zero verifier accepted the seal and journal commitment."
  })
};

describe("receipt proof interface", () => {
  it("passes for a valid local transcript proof", async () => {
    const result = await verifyReceiptProof({ proof: localProof() });

    expect(result.verdict).toBe(true);
    expect(result.checks.find((check) => check.name === "local_transcript_digest")?.passed).toBe(true);
  });

  it("fails when a public input is tampered", async () => {
    const proof = localProof();
    const result = await verifyReceiptProof({
      proof: {
        ...proof,
        statement: {
          ...proof.statement,
          publicInputs: { ...proof.statement.publicInputs, merkleRoot: `sha256:${"9".repeat(64)}` }
        }
      }
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "statement_digest")?.passed).toBe(false);
  });

  it("fails when the statement digest is tampered", async () => {
    const proof = localProof();
    const result = await verifyReceiptProof({
      proof: {
        ...proof,
        statement: { ...proof.statement, statementDigest: `sha256:${"0".repeat(64)}` }
      }
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "statement_digest")?.passed).toBe(false);
  });

  it("fails when a local transcript digest is missing", async () => {
    const proof = localProof();
    const result = await verifyReceiptProof({
      proof: {
        ...proof,
        proof: { backendMetadata: proof.proof.backendMetadata }
      }
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "local_transcript_digest")?.passed).toBe(false);
  });

  it("fails closed for unsupported proof systems", async () => {
    const result = await verifyReceiptProof({ proof: risc0Proof(), allowedProofSystems: ["risc0"] });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "backend_implemented")?.passed).toBe(false);
  });

  it("can delegate a reserved proof system to an explicit backend verifier", async () => {
    const result = await verifyReceiptProof({
      proof: risc0Proof(),
      allowedProofSystems: ["risc0"],
      verifier: risc0Verifier
    });

    expect(result.verdict).toBe(true);
    expect(result.checks.find((check) => check.name === "proof_bytes")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "backend_verification")?.passed).toBe(true);
  });

  it("fails reserved proof systems with malformed proof bytes even if a backend verifier is supplied", async () => {
    const result = await verifyReceiptProof({
      proof: risc0Proof({ proofBytesBase64: "not base64" }),
      allowedProofSystems: ["risc0"],
      verifier: risc0Verifier
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "proof_bytes")?.passed).toBe(false);
  });

  it("fails reserved proof systems that leak local witness metadata", async () => {
    const result = await verifyReceiptProof({
      proof: risc0Proof({
        backendMetadata: {
          transcriptWitnessDigest: `sha256:${"6".repeat(64)}`,
          notZeroKnowledge: true
        }
      }),
      allowedProofSystems: ["risc0"],
      verifier: risc0Verifier
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "private_witness_sealed")?.passed).toBe(false);
  });

  it("rejects a backend that is not in the allowed proof system list", async () => {
    const result = await verifyReceiptProof({ proof: localProof(), allowedProofSystems: ["risc0"] });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "proof_system_allowed")?.passed).toBe(false);
  });

  it("fails when the receipt count is zero", async () => {
    const proof = localProof();
    const result = await verifyReceiptProof({
      proof: {
        ...proof,
        statement: {
          ...proof.statement,
          publicInputs: { ...proof.statement.publicInputs, receiptCount: 0 }
        }
      }
    });

    expect(result.verdict).toBe(false);
    expect(result.checks[0].name).toBe("schema");
  });

  it("fails malformed hash strings", async () => {
    const proof = localProof();
    const result = await verifyReceiptProof({
      proof: {
        ...proof,
        statement: {
          ...proof.statement,
          publicInputs: { ...proof.statement.publicInputs, tenantIdHash: "not-a-hash" }
        }
      }
    });

    expect(result.verdict).toBe(false);
    expect(result.checks[0].name).toBe("schema");
  });

  it("keeps private witness data out of the statement digest", () => {
    const left = createLocalReceiptProof({
      publicInputs,
      claims,
      transcriptWitnessDigest: `sha256:${"6".repeat(64)}`
    });
    const right = createLocalReceiptProof({
      publicInputs,
      claims,
      transcriptWitnessDigest: `sha256:${"7".repeat(64)}`
    });

    expect(left.statement.statementDigest).toBe(right.statement.statementDigest);
    expect(left.proof.transcriptDigest).not.toBe(right.proof.transcriptDigest);
  });

  it("marks private proof bundles as dev-only and not privacy preserving", () => {
    const bundle = {
      schemaVersion: "ghost.private_receipt_proof_bundle.v1",
      receipts: [],
      checkpoint: {},
      inclusionProof: {},
      keyManifest: {},
      proof: localProof(),
      devOnlyWarning: privateReceiptProofBundleWarning()
    };

    expect(bundle.devOnlyWarning).toContain("development harness");
    expect(bundle.devOnlyWarning).toContain("not privacy-preserving");
  });
});
