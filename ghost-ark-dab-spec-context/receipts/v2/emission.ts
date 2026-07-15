import { canonicalize, canonicalSha256Hex, sha256Hex } from "../../../../receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../../shared/src/errors";
import { DecisionReceiptSigner, encodeDecisionReceiptSignatureEnvelope } from "../signer";
import { TransitRecord } from "../../gateway/sidecarProxy";

/**
 * Receipt v2 emission prototype (DRAFT).
 *
 * v2 is a strict superset of ghost.receipt.v1: every v1 field is preserved
 * with v1 naming, and execution_trace binds the per-tool-call transit digests
 * the gateway recorded. This module is additive — it does not modify or import
 * the v1 emission, signer envelope schema, or canonical engine beyond the
 * shared hardened canonicalize(), which rejects host-language non-JSON values
 * before hashing.
 *
 * Not wired into governedInvoke. Not promoted out of draft. The value proven
 * here is that assertion-vs-record divergence becomes receipt-detectable:
 * execution_trace digests are the gateway's record, and the independent
 * verifier recomputes them without importing this file.
 */

export const decisionReceiptV2SchemaVersion = "ghost.receipt.v2" as const;

export type ProvenanceTraceClass = "GATEWAY_RECORDED" | "SOURCE_SIGNED" | "EXTERNALLY_ATTESTED";

export interface DecisionReceiptV2TraceEntry {
  sequence_num: number;
  tool_name: string;
  request_payload_digest: string;
  response_payload_digest: string;
  provenance_class: ProvenanceTraceClass;
}

export interface UnsignedDecisionReceiptV2 {
  schema_version: typeof decisionReceiptV2SchemaVersion;
  receipt_id: string;
  request_id: string;
  tenant_id_hash: string;
  user_id_hash: string;
  session_id_hash: string;
  timestamp: string;
  model_id: string;
  policy_version: string;
  policy_hash: string;
  input_digest: string;
  retrieved_context_digests: string[];
  execution_context_hash: string;
  execution_nonce: string;
  execution_trace: DecisionReceiptV2TraceEntry[];
  decision_pre: string;
  decision_post: string;
  action_taken: string[];
  risk_score: number;
  consent_state: string;
  memory_written: boolean;
  latency_ms: number;
  cost_estimate_usd: number;
  prev_receipt_hash: string | null;
  signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" | "KMS_SIGN_RSASSA_PSS_SHA_256";
}

export interface SignedDecisionReceiptV2 extends UnsignedDecisionReceiptV2 {
  receipt_signature: string;
}

export type DecisionReceiptV2BuildInput = Omit<UnsignedDecisionReceiptV2, "schema_version" | "receipt_id">;

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const anyDigestPattern = /^(?:sha256|hmac-sha256):[a-f0-9]{64}$/u;
const policyHashPattern = /^[a-f0-9]{64}$/u;
const executionNoncePattern = /^[A-Za-z0-9._:-]{8,256}$/u;
const toolNamePattern = /^[A-Za-z0-9._:-]{1,256}$/u;
const allowedTraceClasses: ReadonlySet<ProvenanceTraceClass> = new Set([
  "GATEWAY_RECORDED",
  "SOURCE_SIGNED",
  "EXTERNALLY_ATTESTED"
]);

function v2Error(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.decision_receipt_v2.v1", ...context });
}

function assertDigest(name: string, value: string, pattern: RegExp): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw v2Error(`${name} has an invalid digest shape.`, { field: name, value });
  }
}

function assertTraceEntry(entry: DecisionReceiptV2TraceEntry, index: number, previousSeq: number): void {
  if (!entry || typeof entry !== "object") {
    throw v2Error("execution_trace entry must be an object.", { index });
  }
  if (!Number.isSafeInteger(entry.sequence_num) || entry.sequence_num < 0) {
    throw v2Error("execution_trace sequence_num must be a non-negative safe integer.", { index });
  }
  if (entry.sequence_num <= previousSeq && index > 0) {
    throw v2Error("execution_trace sequence_num must be strictly increasing.", {
      index,
      previous: previousSeq,
      observed: entry.sequence_num
    });
  }
  if (typeof entry.tool_name !== "string" || !toolNamePattern.test(entry.tool_name)) {
    throw v2Error("execution_trace tool_name must be 1-256 characters of URL-safe text.", { index });
  }
  assertDigest("request_payload_digest", entry.request_payload_digest, sha256DigestPattern);
  assertDigest("response_payload_digest", entry.response_payload_digest, sha256DigestPattern);
  if (!allowedTraceClasses.has(entry.provenance_class)) {
    throw v2Error("execution_trace provenance_class must be an assignable non-agent class.", {
      index,
      observed: entry.provenance_class
    });
  }
}

/** Convert gateway transit records into ordered execution_trace entries. */
export function executionTraceFromTransitRecords(records: TransitRecord[]): DecisionReceiptV2TraceEntry[] {
  return [...records]
    .sort((a, b) => a.sequenceNum - b.sequenceNum)
    .map((record) => ({
      sequence_num: record.sequenceNum,
      tool_name: record.toolName,
      request_payload_digest: record.requestDigest,
      response_payload_digest: record.responseDigest,
      provenance_class: record.responseEvidence.provenanceClass as ProvenanceTraceClass
    }));
}

function orderedUnsignedV2(input: DecisionReceiptV2BuildInput, receiptId: string): UnsignedDecisionReceiptV2 {
  return {
    schema_version: decisionReceiptV2SchemaVersion,
    receipt_id: receiptId,
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
    execution_context_hash: input.execution_context_hash,
    execution_nonce: input.execution_nonce,
    execution_trace: input.execution_trace,
    decision_pre: input.decision_pre,
    decision_post: input.decision_post,
    action_taken: [...input.action_taken].sort(),
    risk_score: input.risk_score,
    consent_state: input.consent_state,
    memory_written: input.memory_written,
    latency_ms: input.latency_ms,
    cost_estimate_usd: input.cost_estimate_usd,
    prev_receipt_hash: input.prev_receipt_hash,
    signature_alg: input.signature_alg
  };
}

function assertBuildInput(input: DecisionReceiptV2BuildInput): void {
  assertDigest("tenant_id_hash", input.tenant_id_hash, anyDigestPattern);
  assertDigest("user_id_hash", input.user_id_hash, anyDigestPattern);
  assertDigest("session_id_hash", input.session_id_hash, anyDigestPattern);
  assertDigest("input_digest", input.input_digest, anyDigestPattern);
  assertDigest("execution_context_hash", input.execution_context_hash, sha256DigestPattern);
  if (!policyHashPattern.test(input.policy_hash)) {
    throw v2Error("policy_hash must be a bare 64-char sha256 hex.", { field: "policy_hash" });
  }
  if (!executionNoncePattern.test(input.execution_nonce)) {
    throw v2Error("execution_nonce must be 8-256 characters of URL-safe text.", { field: "execution_nonce" });
  }
  for (const digest of input.retrieved_context_digests) {
    assertDigest("retrieved_context_digest", digest, anyDigestPattern);
  }
  let previousSeq = -1;
  input.execution_trace.forEach((entry, index) => {
    assertTraceEntry(entry, index, previousSeq);
    previousSeq = entry.sequence_num;
  });
  if (input.prev_receipt_hash !== null) {
    assertDigest("prev_receipt_hash", input.prev_receipt_hash, sha256DigestPattern);
  }
}

export function receiptIdFromUnsignedV2(input: Omit<UnsignedDecisionReceiptV2, "receipt_id">): string {
  return `grct2_${canonicalSha256Hex(input)}`;
}

export function buildUnsignedDecisionReceiptV2(input: DecisionReceiptV2BuildInput): UnsignedDecisionReceiptV2 {
  assertBuildInput(input);
  const withoutId = orderedUnsignedV2(input, "");
  const { receipt_id: _drop, ...identityPayload } = withoutId;
  const receiptId = receiptIdFromUnsignedV2(identityPayload);
  return orderedUnsignedV2(input, receiptId);
}

export function canonicalUnsignedDecisionReceiptV2(receipt: UnsignedDecisionReceiptV2): string {
  return canonicalize(receipt);
}

export function decisionReceiptV2Digest(receipt: UnsignedDecisionReceiptV2): string {
  return sha256Hex(canonicalUnsignedDecisionReceiptV2(receipt));
}

export function signDecisionReceiptV2(
  receipt: UnsignedDecisionReceiptV2,
  signer: DecisionReceiptSigner
): SignedDecisionReceiptV2 {
  if (receipt.signature_alg !== signer.algorithm) {
    throw v2Error("receipt signature_alg does not match signer algorithm.", {
      receiptAlgorithm: receipt.signature_alg,
      signerAlgorithm: signer.algorithm
    });
  }
  const canonicalPayload = canonicalUnsignedDecisionReceiptV2(receipt);
  const signature = signer.signCanonical(canonicalPayload);
  const receiptSignature = encodeDecisionReceiptSignatureEnvelope({
    schemaVersion: "ghost.decision_receipt_signature.v1",
    keyId: signer.keyId,
    algorithm: signer.algorithm,
    digestSha256: decisionReceiptV2Digest(receipt),
    signature
  });
  return { ...receipt, receipt_signature: receiptSignature };
}
