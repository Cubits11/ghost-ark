import { createHmac, randomBytes } from "crypto";
import { canonicalSha256Hex, canonicalize, sha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../shared/src/errors";
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

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const hmacSha256DigestPattern = /^hmac-sha256:[a-f0-9]{64}$/u;
const executionNoncePattern = /^[A-Za-z0-9_-]{12,256}$/u;

function receiptCanonicalizationError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.decision_receipt_canonical.v1", ...context });
}

function assertString(name: string, value: string): void {
  if (typeof value !== "string") {
    throw receiptCanonicalizationError(`${name} must be a string.`, { field: name });
  }
}

function assertNonEmptyString(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw receiptCanonicalizationError(`${name} must be a non-empty string.`, { field: name });
  }
}

function assertDigestShape(name: string, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw receiptCanonicalizationError(`${name} has an invalid digest shape.`, { field: name, value });
  }
}

function assertExecutionNonceShape(value: string): void {
  if (!executionNoncePattern.test(value)) {
    throw receiptCanonicalizationError("execution_nonce must be a URL-safe nonce between 12 and 256 characters.", {
      field: "execution_nonce"
    });
  }
}

export function createExecutionNonce(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes < 18 || bytes > 96) {
    throw receiptCanonicalizationError("Execution nonce byte length must be a safe integer between 18 and 96.", {
      bytes
    });
  }

  return randomBytes(bytes).toString("base64url");
}

export function publicSha256Digest(value: string): string {
  assertString("value", value);
  return `sha256:${sha256Hex(value)}`;
}

export function privateHmacDigest(secret: string, value: string): string {
  assertNonEmptyString("secret", secret);
  assertString("value", value);
  return `hmac-sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

export function isDefaultExecutionBoundary(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): boolean {
  return (
    receipt.execution_context_hash === DEFAULT_EXECUTION_CONTEXT_HASH ||
    receipt.execution_nonce === DEFAULT_EXECUTION_NONCE
  );
}

export function assertNonDefaultExecutionBoundary(receipt: UnsignedDecisionReceipt | SignedDecisionReceipt): void {
  const unsigned = unsignedReceiptForSigning(receipt);

  if (unsigned.execution_context_hash === DEFAULT_EXECUTION_CONTEXT_HASH) {
    throw receiptCanonicalizationError("Production decision receipts must not use the default execution_context_hash.", {
      field: "execution_context_hash"
    });
  }

  if (unsigned.execution_nonce === DEFAULT_EXECUTION_NONCE) {
    throw receiptCanonicalizationError("Production decision receipts must not use the default local-dev execution_nonce.", {
      field: "execution_nonce"
    });
  }
}

function receiptIdentityPayload(input: Omit<UnsignedDecisionReceipt, "receipt_id">): Omit<UnsignedDecisionReceipt, "receipt_id"> {
  return input;
}

export function receiptIdFromUnsignedDecisionReceipt(input: Omit<UnsignedDecisionReceipt, "receipt_id">): string {
  return `grct_${canonicalSha256Hex(receiptIdentityPayload(input))}`;
}

export function buildUnsignedDecisionReceipt(input: DecisionReceiptBuildInputWithDefaults): UnsignedDecisionReceipt {
  if (input.execution_context_hash !== undefined) {
    assertDigestShape("execution_context_hash", input.execution_context_hash, sha256DigestPattern);
  }

  if (input.input_digest.startsWith("hmac-sha256:")) {
    assertDigestShape("input_digest", input.input_digest, hmacSha256DigestPattern);
  } else {
    assertDigestShape("input_digest", input.input_digest, sha256DigestPattern);
  }

  const executionNonce = input.execution_nonce ?? DEFAULT_EXECUTION_NONCE;
  assertExecutionNonceShape(executionNonce);

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
    execution_nonce: executionNonce,
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