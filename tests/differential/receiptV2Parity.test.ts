/**
 * Differential parity for receipt v2.
 *
 * The emitter (production TS) and the standalone Node-builtins verifier are
 * developed independently: the verifier reimplements canonicalization,
 * identity, digest binding, and trace validation without importing the
 * emitter. Agreement across a valid receipt and a battery of tampers is the
 * cross-check that neither side is silently wrong.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  buildUnsignedDecisionReceiptV2,
  signDecisionReceiptV2,
  DecisionReceiptV2BuildInput
} from "../../packages/enforcement-runtime/src/receipts/v2/emission";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { privateHmacDigest, publicSha256Digest } from "../../packages/enforcement-runtime/src/receipts/canonical";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- standalone verifier is an untyped Node-builtins-only .mjs module
import { verifyReceiptV2 } from "../../verifiers/node/ghost_receipt_v2_verify.mjs";

const HMAC_SECRET = "ghost-ark-v2-parity-dev-only";

function digest(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function validInput(): DecisionReceiptV2BuildInput {
  return {
    request_id: "request-parity-1",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-15T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "c".repeat(64),
    input_digest: publicSha256Digest("prompt"),
    retrieved_context_digests: [digest("ctx-1")],
    execution_context_hash: digest("exec"),
    execution_nonce: "nonce-parity-0001",
    execution_trace: [
      { sequence_num: 0, tool_name: "PostgresTool", request_payload_digest: digest("q0"), response_payload_digest: digest("r0"), provenance_class: "GATEWAY_RECORDED" },
      { sequence_num: 1, tool_name: "S3Reader", request_payload_digest: digest("q1"), response_payload_digest: digest("r1"), provenance_class: "SOURCE_SIGNED" }
    ],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt", "invoke_model"],
    risk_score: 0.1,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 30,
    cost_estimate_usd: 0.002,
    prev_receipt_hash: null,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
  };
}

function signedReceipt(): Record<string, unknown> {
  const unsigned = buildUnsignedDecisionReceiptV2(validInput());
  const signer = new LocalDevHmacReceiptSigner({ secret: HMAC_SECRET });
  return signDecisionReceiptV2(unsigned, signer) as unknown as Record<string, unknown>;
}

describe("receipt v2 emitter/verifier parity", () => {
  it("accepts a well-formed signed v2 receipt", () => {
    const result = verifyReceiptV2(signedReceipt(), { hmacSecret: HMAC_SECRET });
    expect(result.verdict).toBe(true);
    expect(result.checks.find((c: { name: string }) => c.name === "signature").passed).toBe(true);
    expect(result.checks.find((c: { name: string }) => c.name === "execution_trace").passed).toBe(true);
  });

  it("fails closed when a trace response digest is tampered after signing", () => {
    const receipt = signedReceipt();
    (receipt.execution_trace as Array<{ response_payload_digest: string }>)[0].response_payload_digest = digest("forged");
    const result = verifyReceiptV2(receipt, { hmacSecret: HMAC_SECRET });
    expect(result.verdict).toBe(false);
    // receipt_id and digest both re-derive from the trace, so both bindings break.
    expect(result.checks.find((c: { name: string }) => c.name === "receipt_id").passed).toBe(false);
    expect(result.checks.find((c: { name: string }) => c.name === "digest").passed).toBe(false);
  });

  it("fails closed on a wrong HMAC secret", () => {
    const result = verifyReceiptV2(signedReceipt(), { hmacSecret: "wrong-secret" });
    expect(result.verdict).toBe(false);
    expect(result.checks.find((c: { name: string }) => c.name === "signature").passed).toBe(false);
  });

  it("fails closed on a tenant expectation mismatch", () => {
    const result = verifyReceiptV2(signedReceipt(), { hmacSecret: HMAC_SECRET, expectedTenantHash: privateHmacDigest("secret", "other-tenant") });
    expect(result.verdict).toBe(false);
  });

  it("fails closed on an out-of-order execution_trace", () => {
    const receipt = signedReceipt();
    receipt.execution_trace = [
      { sequence_num: 5, tool_name: "T", request_payload_digest: digest("a"), response_payload_digest: digest("b"), provenance_class: "GATEWAY_RECORDED" },
      { sequence_num: 1, tool_name: "T", request_payload_digest: digest("c"), response_payload_digest: digest("d"), provenance_class: "GATEWAY_RECORDED" }
    ];
    const result = verifyReceiptV2(receipt, { hmacSecret: HMAC_SECRET });
    expect(result.verdict).toBe(false);
    expect(result.checks.find((c: { name: string }) => c.name === "execution_trace").passed).toBe(false);
  });
});
