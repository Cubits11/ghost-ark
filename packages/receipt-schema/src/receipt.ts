import { z } from "zod";
import { canonicalSha256Hex, receiptIdFromPayload } from "./hashCanonicalization";
import { ValidationError } from "../../shared/src/errors";

export const receiptSchemaVersion = "ghost-ark.receipt.v1" as const;

export const tenantSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,47}$/u, "tenant slug must be lowercase, DNS-like, and at most 48 characters");

export const receiptSubjectSchema = z.object({
  kind: z.enum(["evidence-object", "dataset-version", "claim", "export-pack", "transform-run"]),
  id: z.string().min(1),
  uri: z.string().optional(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const governanceContextSchema = z.object({
  lakeFormationTags: z.record(z.string()).default({}),
  rowFilter: z.string().optional(),
  columnRestrictions: z.array(z.string()).default([]),
  policyCompilerVersion: z.string().default("50.0.0"),
  iamPolicyHash: z.string().optional()
});

export const receiptPayloadSchema = z.object({
  receiptId: z.string().regex(/^rct_[a-f0-9]{64}$/u),
  schemaVersion: z.literal(receiptSchemaVersion),
  tenantSlug: tenantSlugSchema,
  issuedAt: z.string().datetime(),
  subject: receiptSubjectSchema,
  evidenceObjects: z.array(z.string().min(1)).min(1),
  lineageEventIds: z.array(z.string().min(1)).default([]),
  claimIds: z.array(z.string().min(1)).default([]),
  governanceContext: governanceContextSchema,
  transform: z
    .object({
      runId: z.string().optional(),
      jobName: z.string().optional(),
      inputVersion: z.string().optional(),
      outputVersion: z.string().optional(),
      parameters: z.record(z.unknown()).default({})
    })
    .optional()
});

export const receiptSignatureSchema = z.object({
  keyId: z.string().min(1),
  algorithm: z.string().min(1),
  messageType: z.literal("DIGEST"),
  digestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  signatureBase64: z.string().min(1),
  signedAt: z.string().datetime()
});

export const receiptRecordSchema = z.object({
  payload: receiptPayloadSchema,
  signature: receiptSignatureSchema,
  status: z.enum(["issued", "superseded", "revoked", "disputed"]).default("issued"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ReceiptSubject = z.infer<typeof receiptSubjectSchema>;
export type GovernanceContext = z.infer<typeof governanceContextSchema>;
export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;
export type ReceiptSignature = z.infer<typeof receiptSignatureSchema>;
export type ReceiptRecord = z.infer<typeof receiptRecordSchema>;

export interface BuildReceiptPayloadInput {
  tenantSlug: string;
  subject: ReceiptSubject;
  evidenceObjects: string[];
  lineageEventIds?: string[];
  claimIds?: string[];
  governanceContext: GovernanceContext;
  transform?: ReceiptPayload["transform"];
  issuedAt?: string;
}

export function buildReceiptPayload(input: BuildReceiptPayloadInput): ReceiptPayload {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const bodyWithoutId = {
    schemaVersion: receiptSchemaVersion,
    tenantSlug: input.tenantSlug,
    issuedAt,
    subject: input.subject,
    evidenceObjects: [...input.evidenceObjects].sort(),
    lineageEventIds: [...(input.lineageEventIds ?? [])].sort(),
    claimIds: [...(input.claimIds ?? [])].sort(),
    governanceContext: input.governanceContext,
    ...(input.transform !== undefined ? { transform: input.transform } : {})
  };
  const receiptId = receiptIdFromPayload(bodyWithoutId);
  const parsed = receiptPayloadSchema.safeParse({ receiptId, ...bodyWithoutId });
  if (!parsed.success) {
    throw new ValidationError("Invalid receipt payload", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function validateReceiptPayload(value: unknown): ReceiptPayload {
  const parsed = receiptPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid receipt payload", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function validateReceiptRecord(value: unknown): ReceiptRecord {
  const parsed = receiptRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid receipt record", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function receiptDigest(payload: ReceiptPayload): string {
  return canonicalSha256Hex(validateReceiptPayload(payload));
}
