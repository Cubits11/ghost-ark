import { createHmac, timingSafeEqual } from "crypto";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import {
  RuntimeAttestation,
  RuntimeAttestationBinding,
  RuntimeAttestationSignatureVerifier,
  RuntimeIdentity,
  runtimeAttestationSubjectDigest,
  validateRuntimeAttestation
} from "./runtimeAttestation";

export interface LocalDevRuntimeAttesterInput {
  readonly secret: string;
  readonly attestationIdPrefix?: string;
  readonly measurements?: Record<string, string>;
}

function assertSecret(secret: string): void {
  if (secret.length === 0) {
    throw new Error("Local dev runtime attestation secret must be non-empty.");
  }
}

export function localRuntimeAttestationSignaturePayloadDigest(attestation: RuntimeAttestation): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.local_runtime_attestation.signature_payload.v1",
    attestationType: attestation.attestationType,
    subjectDigest: attestation.subjectDigest,
    issuedAt: attestation.issuedAt,
    runtime: attestation.runtime,
    binding: attestation.binding,
    measurements: attestation.measurements ?? {}
  })}`;
}

export function signLocalRuntimeAttestation(secret: string, attestation: RuntimeAttestation): string {
  assertSecret(secret);
  const payloadDigest = localRuntimeAttestationSignaturePayloadDigest(attestation);
  return `hmac-sha256:${createHmac("sha256", secret).update(payloadDigest).digest("hex")}`;
}

function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class LocalDevRuntimeAttester {
  private readonly secret: string;
  private readonly attestationIdPrefix: string;
  private readonly measurements: Record<string, string>;

  constructor(input: LocalDevRuntimeAttesterInput) {
    assertSecret(input.secret);
    this.secret = input.secret;
    this.attestationIdPrefix = input.attestationIdPrefix ?? "local-dev-att";
    this.measurements = input.measurements ?? {};
  }

  attest(input: {
    runtime: RuntimeIdentity;
    binding: RuntimeAttestationBinding;
    issuedAt?: string;
  }): RuntimeAttestation {
    const issuedAt = input.issuedAt ?? new Date().toISOString();
    const attestationType = "local-dev-attestation";
    const subjectDigest = runtimeAttestationSubjectDigest({
      attestationType,
      issuedAt,
      runtime: input.runtime,
      binding: input.binding,
      measurements: this.measurements
    });
    const unsigned: RuntimeAttestation = {
      schemaVersion: "ghost.runtime_attestation.v1",
      attestationType,
      attestationId: `${this.attestationIdPrefix}_${canonicalSha256Hex({
        schemaVersion: "ghost.local_runtime_attestation.id.v1",
        subjectDigest
      }).slice(0, 32)}`,
      subjectDigest,
      issuedAt,
      runtime: input.runtime,
      measurements: this.measurements,
      binding: input.binding,
      signature: {
        algorithm: "hmac-sha256",
        value: ""
      }
    };

    return validateRuntimeAttestation({
      ...unsigned,
      signature: {
        algorithm: "hmac-sha256",
        value: signLocalRuntimeAttestation(this.secret, unsigned)
      }
    });
  }
}

export class LocalDevRuntimeAttestationVerifier implements RuntimeAttestationSignatureVerifier {
  readonly supportedAlgorithms = ["hmac-sha256"] as const;
  readonly supportedTypes = ["local-dev-attestation"] as const;

  private readonly secret: string;

  constructor(input: { secret: string }) {
    assertSecret(input.secret);
    this.secret = input.secret;
  }

  verify(input: { attestation: RuntimeAttestation }): boolean {
    const attestation = validateRuntimeAttestation(input.attestation);
    if (attestation.attestationType !== "local-dev-attestation" || attestation.signature.algorithm !== "hmac-sha256") {
      return false;
    }
    const expected = signLocalRuntimeAttestation(this.secret, {
      ...attestation,
      signature: { ...attestation.signature, value: "" }
    });
    return constantTimeStringEquals(attestation.signature.value, expected);
  }
}
