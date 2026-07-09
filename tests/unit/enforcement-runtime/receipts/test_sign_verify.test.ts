import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { verifyDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/verifier";

function unsignedReceipt() {
  return buildUnsignedDecisionReceipt({
    request_id: "request-a",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-07T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "b".repeat(64),
    input_digest: publicSha256Digest("hello"),
    retrieved_context_digests: [],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 10,
    cost_estimate_usd: 0,
    prev_receipt_hash: null,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
  });
}

describe("decision receipt signing and verification", () => {
  it("verifies a locally signed decision receipt", async () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const signed = signDecisionReceipt(unsignedReceipt(), signer);
    const result = await verifyDecisionReceipt(signed, signer);

    expect(result.verdict).toBe(true);
    expect(result.checks.map((check) => [check.name, check.passed])).toEqual([
      ["schema", true],
      ["receipt_id", true],
      ["algorithm", true],
      ["envelope", true],
      ["key_id", true],
      ["digest", true],
      ["canonical_payload", true],
      ["signature", true]
    ]);
  });

  it("fails when the signed policy-bound field is tampered", async () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const signed = signDecisionReceipt(unsignedReceipt(), signer);
    const tampered = { ...signed, policy_hash: "c".repeat(64) };
    const result = await verifyDecisionReceipt(tampered, signer);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "receipt_id")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the verifier uses a different secret", async () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const verifier = new LocalDevHmacReceiptSigner({ secret: "different-secret" });
    const result = await verifyDecisionReceipt(signDecisionReceipt(unsignedReceipt(), signer), verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });
});
