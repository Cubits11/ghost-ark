import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { KeyManifest, validateKeyManifest } from "../../../../packages/enforcement-runtime/src/receipts/keyManifest";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { verifyDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/verifier";

const signer = new LocalDevHmacReceiptSigner({ keyId: "local-dev-hmac", secret: "local-secret" });

function receiptAt(timestamp: string) {
  return signDecisionReceipt(
    buildUnsignedDecisionReceipt({
      request_id: `request-${timestamp}`,
      tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
      user_id_hash: privateHmacDigest("secret", "user-a"),
      session_id_hash: privateHmacDigest("secret", "session-a"),
      timestamp,
      model_id: "anthropic.claude-test",
      policy_version: "organization:org@1",
      policy_hash: "d".repeat(64),
      input_digest: publicSha256Digest(timestamp),
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
      signature_alg: signer.algorithm
    }),
    signer
  );
}

describe("key transparency manifest verification", () => {
  it("accepts historical receipts before revocation and rejects post-revocation receipts", async () => {
    const manifest: KeyManifest = {
      schemaVersion: "ghost.key_manifest.v1",
      generatedAt: "2026-07-08T00:00:00.000Z",
      keys: [
        {
          keyId: "local-dev-hmac",
          algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
          validFrom: "2026-07-07T00:00:00.000Z",
          validUntil: "2026-07-09T00:00:00.000Z",
          status: "REVOKED",
          revokedAt: "2026-07-07T12:30:00.000Z",
          reason: "emergency rotation drill"
        },
        {
          keyId: "local-dev-hmac-next",
          algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
          validFrom: "2026-07-07T12:30:00.000Z",
          status: "ACTIVE"
        }
      ]
    };

    const historical = await verifyDecisionReceipt(receiptAt("2026-07-07T12:00:00.000Z"), signer, { keyManifest: manifest });
    const postRevocation = await verifyDecisionReceipt(receiptAt("2026-07-07T13:00:00.000Z"), signer, {
      keyManifest: manifest
    });

    expect(historical.verdict).toBe(true);
    expect(historical.checks.find((check) => check.name === "key_manifest")?.detail).toMatch(/historical/u);
    expect(postRevocation.verdict).toBe(false);
    expect(postRevocation.checks.find((check) => check.name === "key_manifest")).toMatchObject({ passed: false });
    expect(postRevocation.checks.find((check) => check.name === "signature")).toMatchObject({ passed: true });
  });

  it("rejects duplicate key epochs and inverted validity windows", async () => {
    const duplicateManifest: KeyManifest = {
      schemaVersion: "ghost.key_manifest.v1",
      generatedAt: "2026-07-08T00:00:00.000Z",
      keys: [
        {
          keyId: "local-dev-hmac",
          algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
          validFrom: "2026-07-07T00:00:00.000Z",
          status: "ACTIVE"
        },
        {
          keyId: "local-dev-hmac",
          algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
          validFrom: "2026-07-08T00:00:00.000Z",
          status: "DEPRECATED"
        }
      ]
    };
    const invertedWindowManifest: KeyManifest = {
      schemaVersion: "ghost.key_manifest.v1",
      generatedAt: "2026-07-08T00:00:00.000Z",
      keys: [
        {
          keyId: "local-dev-hmac",
          algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
          validFrom: "2026-07-08T00:00:00.000Z",
          validUntil: "2026-07-07T00:00:00.000Z",
          status: "ACTIVE"
        }
      ]
    };

    expect(() => validateKeyManifest(duplicateManifest)).toThrow(/Duplicate key manifest entry/u);
    expect(() => validateKeyManifest(invertedWindowManifest)).toThrow(/validUntil/u);

    const result = await verifyDecisionReceipt(receiptAt("2026-07-07T12:00:00.000Z"), signer, {
      keyManifest: duplicateManifest
    });
    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "key_manifest")?.detail).toMatch(/invalid/u);
  });
});
