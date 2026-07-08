import { z } from "zod";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";

export type RuntimeAttestationType = "local-dev-attestation" | "aws-nitro-enclave";

export interface RuntimeIdentity {
  readonly runtimeId: string;
  readonly imageDigest: string;
  readonly codeDigest: string;
  readonly policyCompilerDigest: string;
}

export interface RuntimeAttestationBinding {
  readonly receiptHash?: string;
  readonly checkpointDigest?: string;
  readonly payloadDigest?: string;
}

export interface RuntimeAttestation {
  readonly schemaVersion: "ghost.runtime_attestation.v1";
  readonly attestationType: RuntimeAttestationType;
  readonly attestationId: string;
  readonly subjectDigest: string;
  readonly issuedAt: string;
  readonly runtime: RuntimeIdentity;
  readonly measurements?: Record<string, string>;
  readonly binding: RuntimeAttestationBinding;
  readonly signature: {
    readonly algorithm: "hmac-sha256" | "ecdsa-sha256" | "rsa-sha256" | "aws-nitro-attestation";
    readonly value: string;
    readonly publicKeyPem?: string;
  };
}

export interface RuntimeAttestationPolicy {
  readonly schemaVersion: "ghost.runtime_attestation_policy.v1";
  readonly allowedTypes: readonly RuntimeAttestationType[];
  readonly requiredRuntimeIds?: readonly string[];
  readonly allowedImageDigests?: readonly string[];
  readonly allowedCodeDigests?: readonly string[];
  readonly allowedPolicyCompilerDigests?: readonly string[];
  readonly maxClockSkewMs?: number;
  readonly requireBindingToReceipt?: boolean;
  readonly requireBindingToCheckpoint?: boolean;
  readonly requireBindingToPayload?: boolean;
}

export interface RuntimeAttestationVerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface RuntimeAttestationVerificationResult {
  readonly verdict: boolean;
  readonly checks: readonly RuntimeAttestationVerificationCheck[];
}

export interface RuntimeAttestationSignatureVerifier {
  readonly supportedAlgorithms: readonly RuntimeAttestation["signature"]["algorithm"][];
  readonly supportedTypes: readonly RuntimeAttestationType[];
  verify(input: { attestation: RuntimeAttestation }): boolean | Promise<boolean>;
}

export interface AttestedReceiptBundle<Receipt = unknown> {
  readonly schemaVersion: "ghost.attested_receipt_bundle.v1";
  readonly receipt: Receipt;
  readonly attestation: RuntimeAttestation;
}

export interface AttestedCheckpointBundle<Checkpoint = unknown> {
  readonly schemaVersion: "ghost.attested_checkpoint_bundle.v1";
  readonly checkpoint: Checkpoint;
  readonly attestation: RuntimeAttestation;
}

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const runtimeAttestationTypes = ["local-dev-attestation", "aws-nitro-enclave"] as const;
const signatureAlgorithms = ["hmac-sha256", "ecdsa-sha256", "rsa-sha256", "aws-nitro-attestation"] as const;

const runtimeIdentitySchema: z.ZodType<RuntimeIdentity> = z
  .object({
    runtimeId: z.string().min(1),
    imageDigest: sha256DigestSchema,
    codeDigest: sha256DigestSchema,
    policyCompilerDigest: sha256DigestSchema
  })
  .strict();

const runtimeMeasurementsSchema = z
  .object({
    pcr0: z.string().min(1).optional(),
    pcr1: z.string().min(1).optional(),
    pcr2: z.string().min(1).optional(),
    pcr3: z.string().min(1).optional(),
    pcr4: z.string().min(1).optional(),
    pcr8: z.string().min(1).optional()
  })
  .strict();

const runtimeAttestationBindingSchema: z.ZodType<RuntimeAttestationBinding> = z
  .object({
    receiptHash: sha256DigestSchema.optional(),
    checkpointDigest: sha256DigestSchema.optional(),
    payloadDigest: sha256DigestSchema.optional()
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (!binding.receiptHash && !binding.checkpointDigest && !binding.payloadDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime attestation binding must include at least one receipt, checkpoint, or payload digest."
      });
    }
  });

const runtimeAttestationSchema: z.ZodType<RuntimeAttestation> = z
  .object({
    schemaVersion: z.literal("ghost.runtime_attestation.v1"),
    attestationType: z.enum(runtimeAttestationTypes),
    attestationId: z.string().min(1),
    subjectDigest: sha256DigestSchema,
    issuedAt: z.string().datetime(),
    runtime: runtimeIdentitySchema,
    measurements: runtimeMeasurementsSchema.optional(),
    binding: runtimeAttestationBindingSchema,
    signature: z
      .object({
        algorithm: z.enum(signatureAlgorithms),
        value: z.string().min(1),
        publicKeyPem: z.string().min(1).optional()
      })
      .strict()
  })
  .strict();

const runtimeAttestationPolicySchema: z.ZodType<RuntimeAttestationPolicy> = z
  .object({
    schemaVersion: z.literal("ghost.runtime_attestation_policy.v1"),
    allowedTypes: z.array(z.enum(runtimeAttestationTypes)).min(1),
    requiredRuntimeIds: z.array(z.string().min(1)).optional(),
    allowedImageDigests: z.array(sha256DigestSchema).optional(),
    allowedCodeDigests: z.array(sha256DigestSchema).optional(),
    allowedPolicyCompilerDigests: z.array(sha256DigestSchema).optional(),
    maxClockSkewMs: z.number().int().min(0).optional(),
    requireBindingToReceipt: z.boolean().optional(),
    requireBindingToCheckpoint: z.boolean().optional(),
    requireBindingToPayload: z.boolean().optional()
  })
  .strict();

function check(
  checks: RuntimeAttestationVerificationCheck[],
  name: string,
  passed: boolean,
  detail: string
): void {
  checks.push({ name, passed, detail });
}

function isAllowed<T extends string>(allowed: readonly T[] | undefined, observed: T): boolean {
  return !allowed || allowed.includes(observed);
}

function optionalDigestMatches(expected: string | undefined, observed: string | undefined): boolean {
  return expected === undefined || observed === expected;
}

function bindingForSubjectDigest(binding: RuntimeAttestationBinding): RuntimeAttestationBinding {
  const normalized: {
    receiptHash?: string;
    checkpointDigest?: string;
    payloadDigest?: string;
  } = {};
  if (binding.receiptHash) {
    normalized.receiptHash = binding.receiptHash;
  }
  if (binding.checkpointDigest) {
    normalized.checkpointDigest = binding.checkpointDigest;
  }
  if (binding.payloadDigest) {
    normalized.payloadDigest = binding.payloadDigest;
  }
  return normalized;
}

export function runtimeAttestationSubjectDigest(input: {
  attestationType: RuntimeAttestationType;
  issuedAt: string;
  runtime: RuntimeIdentity;
  binding: RuntimeAttestationBinding;
  measurements?: Record<string, string>;
}): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.runtime_attestation.subject.v1",
    attestationType: input.attestationType,
    issuedAt: input.issuedAt,
    runtime: input.runtime,
    binding: bindingForSubjectDigest(input.binding),
    measurements: input.measurements ?? {}
  })}`;
}

export function validateRuntimeAttestation(value: unknown): RuntimeAttestation {
  return runtimeAttestationSchema.parse(value);
}

export function validateRuntimeAttestationPolicy(value: unknown): RuntimeAttestationPolicy {
  return runtimeAttestationPolicySchema.parse(value);
}

export async function verifyRuntimeAttestation(input: {
  attestation: RuntimeAttestation;
  policy: RuntimeAttestationPolicy;
  expectedReceiptHash?: string;
  expectedCheckpointDigest?: string;
  expectedPayloadDigest?: string;
  verifier?: RuntimeAttestationSignatureVerifier;
}): Promise<RuntimeAttestationVerificationResult> {
  const checks: RuntimeAttestationVerificationCheck[] = [];
  let attestation: RuntimeAttestation;
  let policy: RuntimeAttestationPolicy;

  try {
    attestation = validateRuntimeAttestation(input.attestation);
    policy = validateRuntimeAttestationPolicy(input.policy);
    check(checks, "schema", true, "Runtime attestation and policy schemas are valid.");
  } catch (error) {
    check(checks, "schema", false, error instanceof Error ? error.message : String(error));
    return { verdict: false, checks };
  }

  check(
    checks,
    "attestation_type",
    policy.allowedTypes.includes(attestation.attestationType),
    policy.allowedTypes.includes(attestation.attestationType)
      ? `Attestation type ${attestation.attestationType} is allowed by policy.`
      : `Attestation type ${attestation.attestationType} is not allowed by policy.`
  );

  const expectedSubjectDigest = runtimeAttestationSubjectDigest({
    attestationType: attestation.attestationType,
    issuedAt: attestation.issuedAt,
    runtime: attestation.runtime,
    binding: attestation.binding,
    measurements: attestation.measurements
  });
  check(
    checks,
    "subject_digest",
    attestation.subjectDigest === expectedSubjectDigest,
    attestation.subjectDigest === expectedSubjectDigest
      ? "Subject digest matches the domain-separated canonical attestation subject."
      : `Subject digest mismatch. Expected ${expectedSubjectDigest}; observed ${attestation.subjectDigest}.`
  );

  check(
    checks,
    "runtime_id",
    isAllowed(policy.requiredRuntimeIds, attestation.runtime.runtimeId),
    isAllowed(policy.requiredRuntimeIds, attestation.runtime.runtimeId)
      ? `Runtime id ${attestation.runtime.runtimeId} is allowed.`
      : `Runtime id ${attestation.runtime.runtimeId} is not allowed.`
  );
  check(
    checks,
    "image_digest",
    isAllowed(policy.allowedImageDigests, attestation.runtime.imageDigest),
    isAllowed(policy.allowedImageDigests, attestation.runtime.imageDigest)
      ? "Runtime image digest is allowed."
      : `Runtime image digest ${attestation.runtime.imageDigest} is not allowed.`
  );
  check(
    checks,
    "code_digest",
    isAllowed(policy.allowedCodeDigests, attestation.runtime.codeDigest),
    isAllowed(policy.allowedCodeDigests, attestation.runtime.codeDigest)
      ? "Runtime code digest is allowed."
      : `Runtime code digest ${attestation.runtime.codeDigest} is not allowed.`
  );
  check(
    checks,
    "policy_compiler_digest",
    isAllowed(policy.allowedPolicyCompilerDigests, attestation.runtime.policyCompilerDigest),
    isAllowed(policy.allowedPolicyCompilerDigests, attestation.runtime.policyCompilerDigest)
      ? "Policy compiler digest is allowed."
      : `Policy compiler digest ${attestation.runtime.policyCompilerDigest} is not allowed.`
  );

  if (policy.maxClockSkewMs !== undefined) {
    const issuedAt = Date.parse(attestation.issuedAt);
    const delta = Math.abs(Date.now() - issuedAt);
    check(
      checks,
      "clock_skew",
      Number.isFinite(issuedAt) && delta <= policy.maxClockSkewMs,
      Number.isFinite(issuedAt) && delta <= policy.maxClockSkewMs
        ? `Attestation issuedAt is within maxClockSkewMs ${policy.maxClockSkewMs}.`
        : `Attestation issuedAt ${attestation.issuedAt} is outside maxClockSkewMs ${policy.maxClockSkewMs}.`
    );
  }

  check(
    checks,
    "receipt_binding",
    !policy.requireBindingToReceipt &&
      input.expectedReceiptHash === undefined
      ? true
      : Boolean(attestation.binding.receiptHash) && optionalDigestMatches(input.expectedReceiptHash, attestation.binding.receiptHash),
    attestation.binding.receiptHash
      ? input.expectedReceiptHash && input.expectedReceiptHash !== attestation.binding.receiptHash
        ? `Receipt binding mismatch. Expected ${input.expectedReceiptHash}; observed ${attestation.binding.receiptHash}.`
        : "Receipt binding is present and matches the expected digest when supplied."
      : policy.requireBindingToReceipt || input.expectedReceiptHash
        ? "Receipt binding is required but missing."
        : "Receipt binding was not required."
  );
  check(
    checks,
    "checkpoint_binding",
    !policy.requireBindingToCheckpoint &&
      input.expectedCheckpointDigest === undefined
      ? true
      : Boolean(attestation.binding.checkpointDigest) &&
          optionalDigestMatches(input.expectedCheckpointDigest, attestation.binding.checkpointDigest),
    attestation.binding.checkpointDigest
      ? input.expectedCheckpointDigest && input.expectedCheckpointDigest !== attestation.binding.checkpointDigest
        ? `Checkpoint binding mismatch. Expected ${input.expectedCheckpointDigest}; observed ${attestation.binding.checkpointDigest}.`
        : "Checkpoint binding is present and matches the expected digest when supplied."
      : policy.requireBindingToCheckpoint || input.expectedCheckpointDigest
        ? "Checkpoint binding is required but missing."
        : "Checkpoint binding was not required."
  );
  check(
    checks,
    "payload_binding",
    !policy.requireBindingToPayload &&
      input.expectedPayloadDigest === undefined
      ? true
      : Boolean(attestation.binding.payloadDigest) && optionalDigestMatches(input.expectedPayloadDigest, attestation.binding.payloadDigest),
    attestation.binding.payloadDigest
      ? input.expectedPayloadDigest && input.expectedPayloadDigest !== attestation.binding.payloadDigest
        ? `Payload binding mismatch. Expected ${input.expectedPayloadDigest}; observed ${attestation.binding.payloadDigest}.`
        : "Payload binding is present and matches the expected digest when supplied."
      : policy.requireBindingToPayload || input.expectedPayloadDigest
        ? "Payload binding is required but missing."
        : "Payload binding was not required."
  );

  if (attestation.attestationType === "aws-nitro-enclave" || attestation.signature.algorithm === "aws-nitro-attestation") {
    check(
      checks,
      "signature",
      false,
      "AWS Nitro Enclave attestation validation is not implemented in this verifier; evidence fails closed."
    );
  } else if (!input.verifier) {
    check(checks, "signature", false, "No runtime attestation signature verifier was supplied.");
  } else if (
    !input.verifier.supportedAlgorithms.includes(attestation.signature.algorithm) ||
    !input.verifier.supportedTypes.includes(attestation.attestationType)
  ) {
    check(
      checks,
      "signature",
      false,
      `Verifier does not support ${attestation.attestationType} with ${attestation.signature.algorithm}.`
    );
  } else {
    let signaturePassed = false;
    let detail = "Runtime attestation signature verification completed.";
    try {
      signaturePassed = await input.verifier.verify({ attestation });
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    check(checks, "signature", signaturePassed, signaturePassed ? detail : `Signature verification failed: ${detail}`);
  }

  return { verdict: checks.every((entry) => entry.passed), checks };
}
