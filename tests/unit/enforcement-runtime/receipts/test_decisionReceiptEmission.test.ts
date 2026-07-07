import { describe, expect, it } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import { DefaultDecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { verifyDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/verifier";

function decision(phase: PolicyDecision["phase"], value: PolicyDecision["decision"]): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase,
    decision: value,
    policyVersion: "organization:test@1",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: ["test_action"],
    riskScore: 0,
    reasons: ["test"]
  };
}

describe("decision receipt emission", () => {
  it("builds, signs, and stores a minimized decision receipt", async () => {
    const repository = new InMemoryDecisionReceiptRepository();
    const signer = new LocalDevHmacReceiptSigner({ secret: "signing-secret" });
    const emitter = new DefaultDecisionReceiptEmitter({ signer, repository, hmacSecret: "identity-secret" });
    const receipt = await emitter.emit({
      identity: {
        tenantId: "tenant-a",
        userId: "user-a",
        role: "user",
        sessionId: "session-a",
        requestId: "request-a",
        source: "jwt"
      },
      modelId: "anthropic.claude-test",
      policyVersion: "organization:test@1",
      policyHash: "a".repeat(64),
      inputDigest: "sha256:" + "b".repeat(64),
      retrievedContextDigests: ["sha256:" + "c".repeat(64)],
      preDecision: decision("pre_model", "ALLOW"),
      postDecision: decision("post_model", "REDACT"),
      memoryWritten: false,
      consentState: "not_required",
      latencyMs: 3,
      timestamp: "2026-07-07T12:00:00.000Z"
    });

    expect(receipt.receipt_id).toMatch(/^grct_/u);
    expect(receipt.tenant_id_hash).toMatch(/^hmac-sha256:/u);
    expect(receipt.decision_post).toBe("REDACT");
    expect(await repository.get({ tenantId: receipt.tenant_id_hash, receiptId: receipt.receipt_id })).toEqual(receipt);
    expect((await verifyDecisionReceipt(receipt, signer)).verdict).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("hello");
    expect(JSON.stringify(receipt)).not.toContain("model output");
  });
});
