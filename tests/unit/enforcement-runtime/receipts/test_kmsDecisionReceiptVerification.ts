import { constants, createSign, generateKeyPairSync, KeyObject } from "crypto";
import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";
import { verifyDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/verifier";

function kmsUnsignedReceipt(): UnsignedDecisionReceipt {
  return buildUnsignedDecisionReceipt({
    request_id: "request-a",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-07T12:00:00.000Z",
    model_id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    policy_version: "organization:org@1",
    policy_hash: "b".repeat(64),
    input_digest: publicSha256Digest("hello"),
    retrieved_context_digests: ["sha256:" + "a".repeat(64)],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 10,
    cost_estimate_usd: 0,
    prev_receipt_hash: null,
    signature_alg: "KMS_SIGN_RSASSA_PSS_SHA_256"
  });
}

function keyPair(): { privateKey: KeyObject; publicKeyPem: string } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function signKmsLikeReceipt(receipt: UnsignedDecisionReceipt, privateKey: KeyObject, keyId = "alias/test-kms-key"): SignedDecisionReceipt {
  const canonicalPayload = canonicalUnsignedDecisionReceipt(receipt);
  const signer = createSign("sha256");
  signer.update(canonicalPayload);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST
  });

  return validateSignedDecisionReceipt({
    ...receipt,
    receipt_signature: Buffer.from(
      JSON.stringify({
        keyId,
        digestSha256: decisionReceiptDigest(receipt),
        signature: signature.toString("base64")
      }),
      "utf8"
    ).toString("base64url")
  });
}

describe("KMS decision receipt verification", () => {
  it("verifies a valid KMS-like RSA-PSS SHA-256 signature", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt(signed, verifier);

    expect(result.verdict).toBe(true);
    expect(result.checks.map((check) => [check.name, check.passed])).toEqual([
      ["schema", true],
      ["receipt_id", true],
      ["algorithm", true],
      ["key_id", true],
      ["digest", true],
      ["canonical_payload", true],
      ["signature", true]
    ]);
  });

  it("fails when the policy hash is tampered", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, policy_hash: "c".repeat(64) }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the model id is tampered", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, model_id: "amazon.titan-text-lite-v1" }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "receipt_id")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the input digest is tampered", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, input_digest: "sha256:" + "d".repeat(64) }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
  });

  it("fails with the wrong public key", async () => {
    const signingKeys = keyPair();
    const wrongKeys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), signingKeys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: wrongKeys.publicKeyPem });
    const result = await verifyDecisionReceipt(signed, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the algorithm is wrong", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "algorithm")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the signature envelope is malformed", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: "alias/test-kms-key", publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, receipt_signature: "not-json" }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "key_id")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("still verifies local HMAC decision receipts", async () => {
    const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });
    const { receipt_id: _receiptId, ...receiptWithoutId } = kmsUnsignedReceipt();
    const localUnsigned = buildUnsignedDecisionReceipt({
      ...receiptWithoutId,
      signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
    });
    const result = await verifyDecisionReceipt(signDecisionReceipt(localUnsigned, signer), signer);

    expect(result.verdict).toBe(true);
  });
});
