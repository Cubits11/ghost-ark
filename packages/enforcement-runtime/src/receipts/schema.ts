import { z } from "zod";
import { decisionKindSchema } from "../policy/decisions";

export const decisionReceiptSchemaVersion = "ghost.receipt.v1" as const;
export const decisionReceiptSignatureAlgorithms = ["LOCAL_HMAC_SHA256_DEV_ONLY", "KMS_SIGN_RSASSA_PSS_SHA_256"] as const;

const hex64Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const digestSchema = z.string().regex(/^(sha256|hmac-sha256):[a-f0-9]{64}$/u);
const receiptHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const unsignedDecisionReceiptSchema = z.object({
  schema_version: z.literal(decisionReceiptSchemaVersion),
  receipt_id: z.string().regex(/^grct_[a-f0-9]{64}$/u),
  request_id: z.string().min(1),
  tenant_id_hash: digestSchema,
  user_id_hash: digestSchema,
  session_id_hash: digestSchema,
  timestamp: z.string().datetime(),
  model_id: z.string().min(1),
  policy_version: z.string().min(1),
  policy_hash: hex64Schema,
  input_digest: digestSchema,
  retrieved_context_digests: z.array(digestSchema).default([]),
  execution_context_hash: digestSchema,
  execution_nonce: z.string().regex(/^[A-Za-z0-9._:-]{8,256}$/u),
  decision_pre: decisionKindSchema,
  decision_post: decisionKindSchema,
  action_taken: z.array(z.string().min(1)).default([]),
  risk_score: z.number().min(0).max(1),
  consent_state: z.enum(["granted", "denied", "missing", "not_required"]),
  memory_written: z.boolean(),
  latency_ms: z.number().int().min(0),
  cost_estimate_usd: z.number().min(0),
  prev_receipt_hash: receiptHashSchema.nullable().default(null),
  signature_alg: z.enum(decisionReceiptSignatureAlgorithms)
})
  // Strict: unknown top-level fields are rejected, not silently stripped.
  // Stripping would let a caller smuggle unsigned fields alongside a valid
  // signature and still receive a PASS verdict from verifyDecisionReceipt,
  // because canonicalization runs on the stripped object.
  .strict();

export const signedDecisionReceiptSchema = unsignedDecisionReceiptSchema
  .extend({
    receipt_signature: z.string().min(1)
  })
  .strict();

export type UnsignedDecisionReceipt = z.infer<typeof unsignedDecisionReceiptSchema>;
export type SignedDecisionReceipt = z.infer<typeof signedDecisionReceiptSchema>;

export function validateUnsignedDecisionReceipt(value: unknown): UnsignedDecisionReceipt {
  return unsignedDecisionReceiptSchema.parse(value);
}

export function validateSignedDecisionReceipt(value: unknown): SignedDecisionReceipt {
  return signedDecisionReceiptSchema.parse(value);
}
