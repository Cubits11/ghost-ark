import { describe, expect, it } from "vitest";
import {
  RuntimeAttestation,
  RuntimeAttestationPolicy,
  RuntimeIdentity,
  runtimeAttestationSubjectDigest,
  validateRuntimeAttestation,
  verifyRuntimeAttestation
} from "../../../packages/enforcement-runtime/src/attestation/runtimeAttestation";
import {
  LocalDevRuntimeAttestationVerifier,
  LocalDevRuntimeAttester
} from "../../../packages/enforcement-runtime/src/attestation/localRuntimeAttestation";

const issuedAt = "2026-07-08T12:00:00.000Z";
const receiptHash = `sha256:${"1".repeat(64)}`;
const checkpointDigest = `sha256:${"2".repeat(64)}`;
const payloadDigest = `sha256:${"3".repeat(64)}`;

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

function attester(): LocalDevRuntimeAttester {
  return new LocalDevRuntimeAttester({
    secret: "runtime-attestation-secret",
    measurements: { pcr0: "local-dev-pcr0", pcr1: "local-dev-pcr1" }
  });
}

function verifier(): LocalDevRuntimeAttestationVerifier {
  return new LocalDevRuntimeAttestationVerifier({ secret: "runtime-attestation-secret" });
}

function validAttestation(): RuntimeAttestation {
  return attester().attest({
    runtime,
    binding: { receiptHash, checkpointDigest, payloadDigest },
    issuedAt
  });
}

describe("runtime attestation binding", () => {
  it("passes for a valid local-dev attestation", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy,
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(true);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(true);
  });

  it("fails malformed schemas", () => {
    expect(() =>
      validateRuntimeAttestation({
        ...validAttestation(),
        unexpected: true
      })
    ).toThrow();
  });

  it("fails on the wrong receipt hash", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy,
      expectedReceiptHash: `sha256:${"9".repeat(64)}`,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "receipt_binding")?.passed).toBe(false);
  });

  it("fails on the wrong checkpoint digest", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy: { ...policy, requireBindingToReceipt: false, requireBindingToCheckpoint: true },
      expectedCheckpointDigest: `sha256:${"9".repeat(64)}`,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "checkpoint_binding")?.passed).toBe(false);
  });

  it("fails when a required binding is missing", async () => {
    const attestation = attester().attest({
      runtime,
      binding: { payloadDigest },
      issuedAt
    });
    const result = await verifyRuntimeAttestation({
      attestation,
      policy,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "receipt_binding")?.passed).toBe(false);
  });

  it("fails on the wrong runtime id", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy: { ...policy, requiredRuntimeIds: ["runtime-prod-a"] },
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "runtime_id")?.passed).toBe(false);
  });

  it("fails on the wrong image digest", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy: { ...policy, allowedImageDigests: [`sha256:${"9".repeat(64)}`] },
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "image_digest")?.passed).toBe(false);
  });

  it("fails on the wrong code digest", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy: { ...policy, allowedCodeDigests: [`sha256:${"9".repeat(64)}`] },
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "code_digest")?.passed).toBe(false);
  });

  it("fails on the wrong policy compiler digest", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: validAttestation(),
      policy: { ...policy, allowedPolicyCompilerDigests: [`sha256:${"9".repeat(64)}`] },
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "policy_compiler_digest")?.passed).toBe(false);
  });

  it("fails when the signature is tampered", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: {
        ...validAttestation(),
        signature: { algorithm: "hmac-sha256", value: `hmac-sha256:${"0".repeat(64)}` }
      },
      policy,
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the subject digest does not match the attestation subject", async () => {
    const result = await verifyRuntimeAttestation({
      attestation: {
        ...validAttestation(),
        subjectDigest: `sha256:${"0".repeat(64)}`
      },
      policy,
      expectedReceiptHash: receiptHash,
      verifier: verifier()
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "subject_digest")?.passed).toBe(false);
  });

  it("fails closed for Nitro attestation placeholders until a real Nitro verifier exists", async () => {
    const nitroSubject = {
      attestationType: "aws-nitro-enclave" as const,
      issuedAt,
      runtime,
      binding: { receiptHash },
      measurements: { pcr0: "nitro-pcr0" }
    };
    const nitroAttestation: RuntimeAttestation = {
      schemaVersion: "ghost.runtime_attestation.v1",
      attestationType: "aws-nitro-enclave",
      attestationId: "nitro-placeholder",
      subjectDigest: runtimeAttestationSubjectDigest(nitroSubject),
      issuedAt,
      runtime,
      measurements: nitroSubject.measurements,
      binding: nitroSubject.binding,
      signature: {
        algorithm: "aws-nitro-attestation",
        value: "placeholder"
      }
    };

    const result = await verifyRuntimeAttestation({
      attestation: nitroAttestation,
      policy: { ...policy, allowedTypes: ["aws-nitro-enclave"] },
      expectedReceiptHash: receiptHash
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.detail).toContain("not implemented");
  });
});
