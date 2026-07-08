import { createHmac } from "crypto";
import { canonicalSha256Hex, canonicalize, sha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import {
  SignedDecisionReceipt,
  UnsignedDecisionReceipt,
  decisionReceiptSchemaVersion,
  validateSignedDecisionReceipt,
  validateUnsignedDecisionReceipt
} from "./schema";

export type DecisionReceiptBuildInput = Omit<UnsignedDecisionReceipt, "schema_version" | "receipt_id"> & {
  receipt_id?: string;
};

export type DecisionReceiptBuildInputWithDefaults = Omit<
  UnsignedDecisionReceipt,
  "schema_version" | "receipt_id" | "execution_context_hash" | "execution_nonce"
> & {
  receipt_id?: string;
  execution_context_hash?: string;
  execution_nonce?: string;
};

export const DEFAULT_EXECUTION_CONTEXT_HASH = `sha256:${"0".repeat(64)}`;
export const DEFAULT_EXECUTION_NONCE = "local-dev-execution-nonce";

export function publicSha256Digest(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

export function privateHmacDigest(secret: string, value: string): string {
  return `hmac-sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

function receiptIdentityPayload(input: Omit<UnsignedDecisionReceipt, "receipt_id">): Omit<UnsignedDecisionReceipt, "receipt_id"> {
  return input;
}

export function receiptIdFromUnsignedDecisionReceipt(input: Omit<UnsignedDecisionReceipt, "receipt_id">): string {
  return `grct_${canonicalSha256Hex(receiptIdentityPayload(input))}`;
}

export function buildUnsignedDecisionReceipt(input: DecisionReceiptBuildInputWithDefaults): UnsignedDecisionReceipt {
  const withoutId = {
    schema_version: decisionReceiptSchemaVersion,
    request_id: input.request_id,
    tenant_id_hash: input.tenant_id_hash,
    user_id_hash: input.user_id_hash,
    session_id_hash: input.session_id_hash,
    timestamp: input.timestamp,
    model_id: input.model_id,
    policy_version: input.policy_version,
    policy_hash: input.policy_hash,
    input_digest: input.input_digest,
    retrieved_context_digests: [...input.retrieved_context_digests].sort(),
    execution_context_hash: input.execution_context_hash ?? DEFAULT_EXECUTION_CONTEXT_HASH,
    execution_nonce: input.execution_nonce ?? DEFAULT_EXECUTION_NONCE,
    decision_pre: input.decision_pre,
    decision_post: input.decision_post,
    action_taken: [...input.action_taken].sort(),
    risk_score: input.risk_score,
    consent_state: input.consent_state,
    memory_written: input.memory_written,
    latency_ms: input.latency_ms,
    cost_estimate_usd: input.cost_estimate_usd,
    prev_receipt_hash: input.prev_receipt_hash ?? null,
    signature_alg: input.signature_alg
  } satisfies Omit<UnsignedDecisionReceipt, "receipt_id">;

  return validateUnsignedDecisionReceipt({
    ...withoutId,
    receipt_id: input.receipt_id ?? receiptIdFromUnsignedDecisionReceipt(withoutId)
  });
}

export function unsignedReceiptForSigning(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): UnsignedDecisionReceipt {
  const { receipt_signature: _receiptSignature, ...unsigned } = receipt as SignedDecisionReceipt;
  return validateUnsignedDecisionReceipt(unsigned);
}

export function canonicalUnsignedDecisionReceipt(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): string {
  return canonicalize(unsignedReceiptForSigning(receipt));
}

export function decisionReceiptDigest(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): string {
  return sha256Hex(canonicalUnsignedDecisionReceipt(receipt));
}

export function decisionReceiptRequestDigest(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): string {
  const { receipt_id: _receiptId, prev_receipt_hash: _prevReceiptHash, ...requestStable } = unsignedReceiptForSigning(receipt);
  return sha256Hex(canonicalize(requestStable));
}

export function signedDecisionReceiptHash(receipt: SignedDecisionReceipt): string {
  return `sha256:${canonicalSha256Hex(validateSignedDecisionReceipt(receipt))}`;
}
