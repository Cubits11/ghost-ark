import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  SignCommand,
  type KMSClient,
  VerifyCommand
} from "@aws-sdk/client-kms";
import { constants, createHash, generateKeyPairSync, KeyObject, sign as signDigest, verify as verifyDigest } from "crypto";
import { describe, expect, it } from "vitest";
import {
  buildUnsignedDecisionReceipt,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { DefaultDecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { KmsDecisionReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { KmsDecisionReceiptVerifier } from "../../../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";
import { verifyDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/verifier";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";

const KEY_A_ARN = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000001";
const KEY_B_ARN = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000002";
const KEY_A_UUID = "00000000-0000-0000-0000-000000000001";
const KEY_B_UUID = "00000000-0000-0000-0000-000000000002";

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

function keyPair(): { privateKey: KeyObject; publicKey: KeyObject; publicKeyPem: string; publicKeyDer: Uint8Array } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicKeyDer: new Uint8Array(pair.publicKey.export({ format: "der", type: "spki" }))
  };
}

function signKmsLikeReceipt(receipt: UnsignedDecisionReceipt, privateKey: KeyObject, keyId = KEY_A_ARN): SignedDecisionReceipt {
  const canonicalPayload = canonicalUnsignedDecisionReceipt(receipt);
  const signature = signDigest(null, createHash("sha256").update(canonicalPayload).digest(), {
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

function decision(phase: PolicyDecision["phase"], value: PolicyDecision["decision"]): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase,
    decision: value,
    policyVersion: "organization:test@1",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: ["emit_receipt"],
    riskScore: 0,
    reasons: ["test"]
  };
}

function decodeSignatureEnvelope(receipt: SignedDecisionReceipt): { keyId: string; digestSha256: string; signature: string } {
  return JSON.parse(Buffer.from(receipt.receipt_signature, "base64url").toString("utf8")) as {
    keyId: string;
    digestSha256: string;
    signature: string;
  };
}

function encodeSignatureEnvelope(envelope: { keyId: string; digestSha256: string; signature: string }): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function flipDigestBit(digest: string): string {
  const prefix = "sha256:";
  const firstNibble = Number.parseInt(digest[prefix.length] ?? "0", 16) ^ 1;
  return `${prefix}${firstNibble.toString(16)}${digest.slice(prefix.length + 1)}`;
}

async function emitKmsReceipt(signer: KmsDecisionReceiptSigner): Promise<SignedDecisionReceipt> {
  const emitter = new DefaultDecisionReceiptEmitter({ signer, hmacSecret: "identity-secret" });
  return emitter.emit({
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
    inputDigest: publicSha256Digest("hello"),
    retrievedContextDigests: ["sha256:" + "c".repeat(64)],
    preDecision: decision("pre_model", "ALLOW"),
    postDecision: decision("post_model", "ALLOW"),
    memoryWritten: false,
    consentState: "not_required",
    latencyMs: 3,
    timestamp: "2026-07-07T12:00:00.000Z"
  });
}

class FakeKmsClient {
  readonly commands: { name: string; input: Record<string, unknown> }[] = [];
  private readonly keys = new Map<string, ReturnType<typeof keyPair>>();
  private readonly aliases = new Map<string, string>();

  constructor() {
    this.keys.set(KEY_A_ARN, keyPair());
    this.keys.set(KEY_B_ARN, keyPair());
    this.aliases.set(KEY_A_UUID, KEY_A_ARN);
    this.aliases.set(KEY_B_UUID, KEY_B_ARN);
  }

  setAlias(alias: string, keyArn: string): void {
    this.aliases.set(alias, keyArn);
    const aliasName = alias.startsWith("alias/") ? alias.slice("alias/".length) : alias;
    this.aliases.set(`arn:aws:kms:us-east-1:111122223333:alias/${aliasName}`, keyArn);
  }

  async send(command: DescribeKeyCommand | SignCommand | VerifyCommand | GetPublicKeyCommand): Promise<Record<string, unknown>> {
    const commandName = command.constructor.name;
    this.commands.push({ name: commandName, input: command.input as unknown as Record<string, unknown> });
    if (command instanceof DescribeKeyCommand) {
      const keyArn = this.resolveKeyId(command.input.KeyId);
      return { KeyMetadata: { Arn: keyArn, KeyId: keyArn.slice(keyArn.lastIndexOf("/") + 1) } };
    }
    if (command instanceof SignCommand) {
      const keyArn = this.resolveKeyId(command.input.KeyId);
      this.assertKmsDigestParameters(command.input.MessageType, command.input.SigningAlgorithm);
      const key = this.key(keyArn);
      const signature = signDigest(null, Buffer.from(command.input.Message ?? new Uint8Array()), {
        key: key.privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      });
      return { KeyId: keyArn, Signature: signature, SigningAlgorithm: "RSASSA_PSS_SHA_256" };
    }
    if (command instanceof VerifyCommand) {
      const keyArn = this.resolveKeyId(command.input.KeyId);
      this.assertKmsDigestParameters(command.input.MessageType, command.input.SigningAlgorithm);
      const key = this.key(keyArn);
      const signatureValid = verifyDigest(
        null,
        Buffer.from(command.input.Message ?? new Uint8Array()),
        {
          key: key.publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST
        },
        Buffer.from(command.input.Signature ?? new Uint8Array())
      );
      return { KeyId: keyArn, SignatureValid: signatureValid, SigningAlgorithm: "RSASSA_PSS_SHA_256" };
    }
    if (command instanceof GetPublicKeyCommand) {
      const key = this.key(this.resolveKeyId(command.input.KeyId));
      return { PublicKey: key.publicKeyDer };
    }
    throw new Error(`Unsupported fake KMS command ${commandName}`);
  }

  private resolveKeyId(keyId: string | undefined): string {
    if (!keyId) {
      throw new Error("Missing fake KMS key id");
    }
    const aliasTarget = this.aliases.get(keyId);
    if (aliasTarget) {
      return aliasTarget;
    }
    if (this.keys.has(keyId)) {
      return keyId;
    }
    for (const keyArn of this.keys.keys()) {
      if (keyArn.endsWith(`/${keyId}`)) {
        return keyArn;
      }
    }
    throw new Error(`Unknown fake KMS key id ${keyId}`);
  }

  private key(keyArn: string): ReturnType<typeof keyPair> {
    const key = this.keys.get(keyArn);
    if (!key) {
      throw new Error(`Unknown fake KMS key ${keyArn}`);
    }
    return key;
  }

  private assertKmsDigestParameters(messageType: unknown, signingAlgorithm: unknown): void {
    expect(messageType).toBe("DIGEST");
    expect(signingAlgorithm).toBe("RSASSA_PSS_SHA_256");
  }
}

describe("KMS decision receipt verification", () => {
  it("signs with an immutable key arn and records the KMS-attested key arn", async () => {
    const kms = new FakeKmsClient();
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client: kms as unknown as KMSClient });
    const receipt = await emitKmsReceipt(signer);
    const envelope = decodeSignatureEnvelope(receipt);

    expect(envelope.keyId).toBe(KEY_A_ARN);
    expect(kms.commands.find((command) => command.name === "DescribeKeyCommand")).toBeUndefined();
    expect(kms.commands.find((command) => command.name === "SignCommand")?.input.KeyId).toBe(KEY_A_ARN);
  });

  it("rejects mutable alias signer and verifier key ids", () => {
    const kms = new FakeKmsClient();

    expect(() => new KmsDecisionReceiptSigner({ keyId: "alias/active-key", client: kms as unknown as KMSClient })).toThrow(
      /immutable KMS key/u
    );
    expect(() => new KmsDecisionReceiptVerifier({ keyId: "alias/active-key", client: kms as unknown as KMSClient })).toThrow(
      /immutable KMS key/u
    );
  });

  it("rejects historical alias receipt key ids", async () => {
    const kms = new FakeKmsClient();
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client: kms as unknown as KMSClient });
    const receipt = await emitKmsReceipt(signer);
    const envelope = decodeSignatureEnvelope(receipt);
    const historicalAliasReceipt = {
      ...receipt,
      receipt_signature: encodeSignatureEnvelope({ ...envelope, keyId: "alias/active-key" })
    };
    const warnings: Record<string, unknown>[] = [];
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A_ARN,
      client: kms as unknown as KMSClient,
      logger: {
        warn: (_message, fields) => warnings.push(fields ?? {})
      }
    });
    const result = await verifyDecisionReceipt(historicalAliasReceipt, verifier);

    expect(result.verdict).toBe(false);
    expect(warnings).toHaveLength(0);
    expect(result.checks.find((check) => check.name === "key_id")).toMatchObject({ passed: false });
    expect(kms.commands.filter((command) => command.name === "VerifyCommand")).toHaveLength(0);
  });

  it("rejections", async () => {
    const kms = new FakeKmsClient();
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client: kms as unknown as KMSClient });
    const receipt = await emitKmsReceipt(signer);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, client: kms as unknown as KMSClient });

    const tamperedPayload = {
      ...receipt,
      input_digest: flipDigestBit(receipt.input_digest)
    };
    const tamperedPayloadResult = await verifyDecisionReceipt(tamperedPayload, verifier);
    expect(tamperedPayloadResult.verdict).toBe(false);
    expect(tamperedPayloadResult.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(tamperedPayloadResult.checks.find((check) => check.name === "signature")?.passed).toBe(false);

    const envelope = decodeSignatureEnvelope(receipt);
    const mismatchedKeyReceipt = {
      ...receipt,
      receipt_signature: encodeSignatureEnvelope({ ...envelope, keyId: KEY_B_ARN })
    };
    const mismatchedKeyResult = await verifyDecisionReceipt(mismatchedKeyReceipt, verifier);
    expect(mismatchedKeyResult.verdict).toBe(false);
    expect(mismatchedKeyResult.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("verifies a valid KMS-like RSA-PSS SHA-256 signature", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
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
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, policy_hash: "c".repeat(64) }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the model id is tampered", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, model_id: "amazon.titan-text-lite-v1" }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "receipt_id")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the input digest is tampered", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, input_digest: "sha256:" + "d".repeat(64) }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
  });

  it("fails with the wrong public key", async () => {
    const signingKeys = keyPair();
    const wrongKeys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), signingKeys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: wrongKeys.publicKeyPem });
    const result = await verifyDecisionReceipt(signed, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the algorithm is wrong", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
    const result = await verifyDecisionReceipt({ ...signed, signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" }, verifier);

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "algorithm")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the signature envelope is malformed", async () => {
    const keys = keyPair();
    const signed = signKmsLikeReceipt(kmsUnsignedReceipt(), keys.privateKey);
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A_ARN, publicKeyPem: keys.publicKeyPem });
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
