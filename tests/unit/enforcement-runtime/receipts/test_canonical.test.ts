import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";

function receiptInput() {
  return {
    request_id: "request-a",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-07T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "a".repeat(64),
    input_digest: publicSha256Digest("hello"),
    retrieved_context_digests: [publicSha256Digest("b"), publicSha256Digest("a")],
    decision_pre: "ALLOW" as const,
    decision_post: "REDACT" as const,
    action_taken: ["redact_output", "emit_receipt"],
    risk_score: 0.5,
    consent_state: "not_required" as const,
    memory_written: false,
    latency_ms: 12,
    cost_estimate_usd: 0.001,
    prev_receipt_hash: null,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" as const
  };
}

describe("decision receipt canonicalization", () => {
  it("builds stable receipt ids and digests when arrays are differently ordered", () => {
    const first = buildUnsignedDecisionReceipt(receiptInput());
    const second = buildUnsignedDecisionReceipt({
      ...receiptInput(),
      retrieved_context_digests: [...receiptInput().retrieved_context_digests].reverse(),
      action_taken: [...receiptInput().action_taken].reverse()
    });

    expect(first.receipt_id).toBe(second.receipt_id);
    expect(decisionReceiptDigest(first)).toBe(decisionReceiptDigest(second));
  });

  it("uses HMAC digests for low-entropy private identifiers", () => {
    expect(receiptInput().tenant_id_hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(receiptInput().input_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
