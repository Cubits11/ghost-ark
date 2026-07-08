import { z } from "zod";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";

export type ReceiptProofSystem = "local-transcript" | "risc0" | "sp1" | "halo2" | "noir" | "circom";

export interface ReceiptProofPublicInputs {
  readonly tenantIdHash: string;
  readonly chainHeadHash: string;
  readonly epochId: string;
  readonly checkpointDigest: string;
  readonly merkleRoot: string;
  readonly receiptCount: number;
  readonly keyManifestDigest: string;
}

export interface ReceiptProofClaims {
  readonly receiptSignaturesValid: true;
  readonly receiptChainLinksValid: true;
  readonly tenantConstantAcrossChain: true;
  readonly checkpointIncludesChainHead: true;
  readonly keyManifestEpochsValid: true;
}

export interface ReceiptProofStatement {
  readonly schemaVersion: "ghost.receipt_proof_statement.v1";
  readonly proofSystem: ReceiptProofSystem;
  readonly statementDigest: string;
  readonly publicInputs: ReceiptProofPublicInputs;
  readonly claims: ReceiptProofClaims;
}

export interface ReceiptProof {
  readonly schemaVersion: "ghost.receipt_proof.v1";
  readonly proofSystem: ReceiptProofSystem;
  readonly statement: ReceiptProofStatement;
  readonly proof: {
    readonly transcriptDigest?: string;
    readonly proofBytesBase64?: string;
    readonly backendMetadata?: Record<string, unknown>;
  };
}

export interface ReceiptProofVerificationResult {
  readonly verdict: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
}

export interface PrivateReceiptProofBundle<Receipt = unknown, Checkpoint = unknown, InclusionProof = unknown, KeyManifest = unknown> {
  readonly schemaVersion: "ghost.private_receipt_proof_bundle.v1";
  readonly receipts: readonly Receipt[];
  readonly checkpoint: Checkpoint;
  readonly inclusionProof: InclusionProof;
  readonly keyManifest: KeyManifest;
  readonly proof: ReceiptProof;
  readonly devOnlyWarning: "The private proof bundle is a development harness and is not privacy-preserving.";
}

const proofSystems = ["local-transcript", "risc0", "sp1", "halo2", "noir", "circom"] as const;
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const receiptProofPublicInputsSchema: z.ZodType<ReceiptProofPublicInputs> = z
  .object({
    tenantIdHash: sha256DigestSchema,
    chainHeadHash: sha256DigestSchema,
    epochId: z.string().min(1),
    checkpointDigest: sha256DigestSchema,
    merkleRoot: sha256DigestSchema,
    receiptCount: z.number().int().min(1),
    keyManifestDigest: sha256DigestSchema
  })
  .strict();

const receiptProofClaimsSchema: z.ZodType<ReceiptProofClaims> = z
  .object({
    receiptSignaturesValid: z.literal(true),
    receiptChainLinksValid: z.literal(true),
    tenantConstantAcrossChain: z.literal(true),
    checkpointIncludesChainHead: z.literal(true),
    keyManifestEpochsValid: z.literal(true)
  })
  .strict();

const receiptProofStatementSchema: z.ZodType<ReceiptProofStatement> = z
  .object({
    schemaVersion: z.literal("ghost.receipt_proof_statement.v1"),
    proofSystem: z.enum(proofSystems),
    statementDigest: sha256DigestSchema,
    publicInputs: receiptProofPublicInputsSchema,
    claims: receiptProofClaimsSchema
  })
  .strict();

const receiptProofSchema: z.ZodType<ReceiptProof> = z
  .object({
    schemaVersion: z.literal("ghost.receipt_proof.v1"),
    proofSystem: z.enum(proofSystems),
    statement: receiptProofStatementSchema,
    proof: z
      .object({
        transcriptDigest: sha256DigestSchema.optional(),
        proofBytesBase64: z.string().min(1).optional(),
        backendMetadata: z.record(z.unknown()).optional()
      })
      .strict()
  })
  .strict();

function check(
  checks: ReceiptProofVerificationResult["checks"] extends readonly (infer T)[] ? T[] : never,
  name: string,
  passed: boolean,
  detail: string
): void {
  checks.push({ name, passed, detail });
}

export function receiptProofStatementDigest(input: {
  proofSystem: ReceiptProofSystem;
  publicInputs: ReceiptProofPublicInputs;
  claims: ReceiptProofClaims;
}): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.receipt_proof_statement.digest.v1",
    proofSystem: input.proofSystem,
    publicInputs: input.publicInputs,
    claims: input.claims
  })}`;
}

export function localReceiptProofTranscriptDigest(input: {
  publicInputs: ReceiptProofPublicInputs;
  claims: ReceiptProofClaims;
  transcriptWitnessDigest: string;
}): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.local_receipt_proof_transcript.v1",
    publicInputs: input.publicInputs,
    claims: input.claims,
    transcriptWitnessDigest: input.transcriptWitnessDigest
  })}`;
}

export function validateReceiptProofStatement(value: unknown): ReceiptProofStatement {
  return receiptProofStatementSchema.parse(value);
}

export function validateReceiptProof(value: unknown): ReceiptProof {
  return receiptProofSchema.parse(value);
}

export function privateReceiptProofBundleWarning(): PrivateReceiptProofBundle["devOnlyWarning"] {
  return "The private proof bundle is a development harness and is not privacy-preserving.";
}

function transcriptWitnessDigestFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.transcriptWitnessDigest === "string" ? metadata.transcriptWitnessDigest : undefined;
}

export async function verifyReceiptProof(input: {
  proof: ReceiptProof;
  allowedProofSystems?: readonly ReceiptProofSystem[];
}): Promise<ReceiptProofVerificationResult> {
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
  let proof: ReceiptProof;

  try {
    proof = validateReceiptProof(input.proof);
    check(checks, "schema", true, "Receipt proof schema is valid.");
  } catch (error) {
    check(checks, "schema", false, error instanceof Error ? error.message : String(error));
    return { verdict: false, checks };
  }

  const allowedProofSystems = input.allowedProofSystems ?? ["local-transcript"];
  check(
    checks,
    "proof_system_match",
    proof.proofSystem === proof.statement.proofSystem,
    proof.proofSystem === proof.statement.proofSystem
      ? `Proof system ${proof.proofSystem} matches the statement.`
      : `Proof system mismatch. Proof uses ${proof.proofSystem}; statement uses ${proof.statement.proofSystem}.`
  );
  check(
    checks,
    "proof_system_allowed",
    allowedProofSystems.includes(proof.proofSystem),
    allowedProofSystems.includes(proof.proofSystem)
      ? `Proof system ${proof.proofSystem} is allowed for this verifier run.`
      : `Proof system ${proof.proofSystem} is not allowed for this verifier run.`
  );

  const expectedStatementDigest = receiptProofStatementDigest({
    proofSystem: proof.statement.proofSystem,
    publicInputs: proof.statement.publicInputs,
    claims: proof.statement.claims
  });
  check(
    checks,
    "statement_digest",
    proof.statement.statementDigest === expectedStatementDigest,
    proof.statement.statementDigest === expectedStatementDigest
      ? "Statement digest matches public inputs and claims."
      : `Statement digest mismatch. Expected ${expectedStatementDigest}; observed ${proof.statement.statementDigest}.`
  );
  check(
    checks,
    "receipt_count",
    proof.statement.publicInputs.receiptCount > 0,
    proof.statement.publicInputs.receiptCount > 0
      ? `Receipt count ${proof.statement.publicInputs.receiptCount} is positive.`
      : "Receipt count must be positive."
  );

  if (proof.proofSystem === "local-transcript") {
    const transcriptWitnessDigest = transcriptWitnessDigestFromMetadata(proof.proof.backendMetadata);
    const expectedTranscriptDigest =
      transcriptWitnessDigest && /^sha256:[a-f0-9]{64}$/u.test(transcriptWitnessDigest)
        ? localReceiptProofTranscriptDigest({
            publicInputs: proof.statement.publicInputs,
            claims: proof.statement.claims,
            transcriptWitnessDigest
          })
        : undefined;
    check(
      checks,
      "local_transcript_witness_digest",
      Boolean(transcriptWitnessDigest && /^sha256:[a-f0-9]{64}$/u.test(transcriptWitnessDigest)),
      transcriptWitnessDigest
        ? /^sha256:[a-f0-9]{64}$/u.test(transcriptWitnessDigest)
          ? "Local transcript witness digest is present in dev-only backend metadata."
          : "Local transcript witness digest is malformed."
        : "Local transcript witness digest is missing from dev-only backend metadata."
    );
    check(
      checks,
      "local_transcript_digest",
      Boolean(proof.proof.transcriptDigest && expectedTranscriptDigest && proof.proof.transcriptDigest === expectedTranscriptDigest),
      proof.proof.transcriptDigest
        ? expectedTranscriptDigest && proof.proof.transcriptDigest === expectedTranscriptDigest
          ? "Local transcript digest matches the deterministic dev-only transcript."
          : `Local transcript digest mismatch. Expected ${expectedTranscriptDigest ?? "unavailable"}; observed ${proof.proof.transcriptDigest}.`
        : "Local transcript digest is required for local-transcript proofs."
    );
  } else {
    check(
      checks,
      "backend_implemented",
      false,
      `Proof system ${proof.proofSystem} is a reserved interface and is not implemented in this verifier.`
    );
  }

  return { verdict: checks.every((entry) => entry.passed), checks };
}
