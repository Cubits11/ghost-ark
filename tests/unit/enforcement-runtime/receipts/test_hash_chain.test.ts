import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest,
  signedDecisionReceiptHash
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { verifyDecisionReceiptChain } from "../../../../packages/enforcement-runtime/src/receipts/chain";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";

function buildReceipt(
  prev_receipt_hash: string | null,
  request_id: string,
  overrides: Partial<{
    tenantId: string;
    timestamp: string;
  }> = {}
) {
  return buildUnsignedDecisionReceipt({
    request_id,
    tenant_id_hash: privateHmacDigest("secret", overrides.tenantId ?? "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: overrides.timestamp ?? "2026-07-07T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "d".repeat(64),
    input_digest: publicSha256Digest(request_id),
    retrieved_context_digests: [],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 10,
    cost_estimate_usd: 0,
    prev_receipt_hash,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
  });
}

describe("decision receipt hash chain", () => {
  it("passes when each receipt points to the prior signed receipt hash", () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const first = signDecisionReceipt(buildReceipt(null, "request-a"), signer);
    const second = signDecisionReceipt(buildReceipt(signedDecisionReceiptHash(first), "request-b"), signer);

    expect(verifyDecisionReceiptChain([first, second]).every((entry) => entry.passed)).toBe(true);
  });

  it("fails when continuity breaks", () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const first = signDecisionReceipt(buildReceipt(null, "request-a"), signer);
    const second = signDecisionReceipt(buildReceipt(`sha256:${"0".repeat(64)}`, "request-b"), signer);

    const checks = verifyDecisionReceiptChain([first, second]);
    expect(checks[1].passed).toBe(false);
    expect(checks[1].detail).toMatch(/Hash-chain break/u);
  });

  it("fails when a chain crosses tenant namespaces", () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const first = signDecisionReceipt(buildReceipt(null, "request-a"), signer);
    const second = signDecisionReceipt(
      buildReceipt(signedDecisionReceiptHash(first), "request-b", { tenantId: "tenant-b" }),
      signer
    );

    const checks = verifyDecisionReceiptChain([first, second]);
    expect(checks[1].passed).toBe(false);
    expect(checks[1].detail).toMatch(/Tenant-chain break/u);
  });

  it("fails closed for malformed chain entries", () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const first = signDecisionReceipt(buildReceipt(null, "request-a"), signer);
    const checks = verifyDecisionReceiptChain([first, { schema_version: "ghost.receipt.v1" }]);

    expect(checks[1].passed).toBe(false);
    expect(checks[1].detail).toMatch(/schema validation failed/u);
  });
});
