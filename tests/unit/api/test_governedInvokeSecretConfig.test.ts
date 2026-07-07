import { describe, expect, it } from "vitest";
import { hmacSecretForMode } from "../../../apps/api/src/handlers/invokeGoverned";
import { privateHmacDigest } from "../../../packages/enforcement-runtime/src/receipts/canonical";
import { DEFAULT_DECISION_RECEIPT_HMAC_SECRET, DefaultDecisionReceiptEmitter } from "../../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../../packages/enforcement-runtime/src/receipts/signer";
import { PolicyDecision } from "../../../packages/enforcement-runtime/src/policy/decisions";

function decision(phase: PolicyDecision["phase"]): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase,
    decision: "ALLOW",
    policyVersion: "organization:test@1",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: ["test"],
    riskScore: 0,
    reasons: ["test"]
  };
}

describe("governed invoke HMAC digest secret configuration", () => {
  it("rejects missing HMAC secret configuration in AWS/KMS mode", async () => {
    await expect(hmacSecretForMode({ GHOST_ARK_RECEIPT_SIGNER: "kms" })).rejects.toThrow(/Missing governed invoke/u);
  });

  it("allows the local default only in local signer mode", async () => {
    await expect(hmacSecretForMode({ GHOST_ARK_RECEIPT_SIGNER: "local" })).resolves.toBe(DEFAULT_DECISION_RECEIPT_HMAC_SECRET);
  });

  it("does not allow AWS/KMS mode to use the local default secret", async () => {
    await expect(
      hmacSecretForMode({
        GHOST_ARK_RECEIPT_SIGNER: "kms",
        GHOST_ARK_RECEIPT_HMAC_SECRET: DEFAULT_DECISION_RECEIPT_HMAC_SECRET
      })
    ).rejects.toThrow(/cannot use the local default/u);
  });

  it("uses the configured Secrets Manager value for tenant, user, and session HMAC digests", async () => {
    const secret = await hmacSecretForMode(
      {
        GHOST_ARK_RECEIPT_SIGNER: "kms",
        GHOST_ARK_RECEIPT_HMAC_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:111111111111:secret:test"
      },
      { readSecret: async () => "configured-digest-secret" }
    );
    const repository = new InMemoryDecisionReceiptRepository();
    const emitter = new DefaultDecisionReceiptEmitter({
      signer: new LocalDevHmacReceiptSigner({ secret: "signing-secret" }),
      repository,
      hmacSecret: secret
    });
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
      retrievedContextDigests: [],
      preDecision: decision("pre_model"),
      postDecision: decision("post_model"),
      memoryWritten: false,
      consentState: "not_required",
      latencyMs: 1,
      timestamp: "2026-07-07T12:00:00.000Z"
    });

    expect(receipt.tenant_id_hash).toBe(privateHmacDigest("configured-digest-secret", "tenant-a"));
    expect(receipt.user_id_hash).toBe(privateHmacDigest("configured-digest-secret", "user-a"));
    expect(receipt.session_id_hash).toBe(privateHmacDigest("configured-digest-secret", "session-a"));
  });
});
