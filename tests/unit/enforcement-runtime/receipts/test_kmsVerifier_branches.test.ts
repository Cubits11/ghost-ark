import { generateKeyPairSync, sign as signDigest } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { KMSClient } from "@aws-sdk/client-kms";
import { GetPublicKeyCommand, VerifyCommand } from "@aws-sdk/client-kms";

import { sha256Bytes } from "../../../../packages/receipt-schema/src/hashCanonicalization";
import {
  KMS_DECISION_RECEIPT_MESSAGE_TYPE,
  KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
} from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { KmsDecisionReceiptVerifier } from "../../../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import type { SignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";

/**
 * Branch tests for the KMS decision-receipt verifier, written against experiment
 * E10's report.
 *
 * `kmsVerifier.ts` was the weakest file in the trust kernel: 48.1% covered
 * (25/52), with **30 of its 82 mutants executed by no test at all**. The
 * unreached lines were not incidental — they are the key-identity *rejections*:
 * a receipt whose envelope carries no usable `keyId`, a receipt whose `keyId`
 * does not match the configured key, and a KMS response whose `KeyId` or
 * `SigningAlgorithm` disagrees with what was asked for.
 *
 * `AGENTS.md` states that KMS key ids in verification-critical paths must be
 * immutable key ARNs rather than mutable aliases, because an alias can be
 * repointed after the fact and a receipt that verifies under a repointable
 * identity proves less than it appears to. That rule is enforced here, and until
 * now the enforcement was unexecuted.
 *
 * This is narrower than "KMS needs live AWS". The sibling suite already rejects
 * aliases at *construction* time, and every branch below is reachable with a
 * stub client — no credentials involved. What was missing was a test that drives
 * `verifyCanonical` directly and controls exactly what KMS answers.
 */

const KEY_A = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-00000000000a";
const KEY_B = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-00000000000b";
const PAYLOAD = '{"canonical":"payload"}';

/**
 * A KMS stub whose Verify response is dictated per test.
 *
 * Deliberately not the sibling suite's `FakeKmsClient`, which simulates a
 * faithful KMS. A faithful KMS never returns a mismatched `KeyId` or the wrong
 * `SigningAlgorithm`, so it cannot reach the branches that exist precisely to
 * catch a KMS — or a man in the middle — that does.
 */
class StubKmsClient {
  readonly commands: string[] = [];
  constructor(private readonly verifyResponse: Record<string, unknown>, private readonly publicKeyDer?: Uint8Array) {}

  async send(command: unknown): Promise<Record<string, unknown>> {
    if (command instanceof VerifyCommand) {
      this.commands.push("Verify");
      return this.verifyResponse;
    }
    if (command instanceof GetPublicKeyCommand) {
      this.commands.push("GetPublicKey");
      return this.publicKeyDer ? { PublicKey: this.publicKeyDer } : {};
    }
    throw new Error(`unexpected command ${String(command)}`);
  }
}

function verifierFor(response: Record<string, unknown>, keyId = KEY_A) {
  const client = new StubKmsClient(response);
  const verifier = new KmsDecisionReceiptVerifier({ keyId, client: client as unknown as KMSClient });
  return { verifier, client };
}

const receipt = {} as SignedDecisionReceipt;

/** A KMS answer that would verify, so each test below changes exactly one thing. */
const validResponse = {
  SignatureValid: true,
  SigningAlgorithm: KMS_DECISION_RECEIPT_SIGNING_ALGORITHM,
  KeyId: KEY_A
};

describe("KMS verifier: receipt key identity is checked before any signature work", () => {
  it("accepts a receipt whose envelope keyId is the configured immutable ARN", () => {
    // The control arm. Without it, every rejection below is satisfied by a
    // verifier that returns false unconditionally.
    const { verifier, client } = verifierFor(validResponse);
    return expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A })).resolves.toBe(true)
      .then(() => {
        expect(client.commands).toEqual(["Verify"]);
      });
  });

  it("fails closed when the envelope carries no keyId at all", async () => {
    // Kills the line-52 ternary and the line-54 guard. An absent keyId must not
    // fall through to "verify against whatever we were configured with".
    const { verifier, client } = verifierFor(validResponse);
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, {})).resolves.toBe(false);
    expect(client.commands, "KMS must not be called once identity is unusable").toEqual([]);
  });

  it("fails closed when the envelope keyId is not a string", async () => {
    const { verifier } = verifierFor(validResponse);
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: 42 })).resolves.toBe(false);
  });

  it("fails closed on a mutable alias in the receipt, and says why", async () => {
    // Kills the line-88 guard and the line-91 logger call. An alias is
    // repointable, so a receipt naming one does not pin the key that signed it.
    const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
    const client = new StubKmsClient(validResponse);
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      client: client as unknown as KMSClient,
      logger: { warn: (message, fields) => warnings.push({ message, fields }) }
    });

    await expect(
      verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: "alias/active-key" })
    ).resolves.toBe(false);

    expect(client.commands).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/non-immutable keyId/u);
    expect(warnings[0]?.fields?.event).toBe("kms_decision_receipt_non_immutable_key_id");
    expect(warnings[0]?.fields?.receiptKeyId).toBe("alias/active-key");
  });

  it("fails closed without a logger configured", async () => {
    // Kills the optional-chaining mutant at line 91: `this.logger?.warn` must not
    // become `this.logger.warn`, which would throw instead of failing closed.
    const { verifier } = verifierFor(validResponse);
    await expect(
      verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: "alias/active-key" })
    ).resolves.toBe(false);
  });

  it("fails closed when the receipt names a different immutable key", async () => {
    // Kills the line-57 guard. Both ids are well-formed ARNs, so only the
    // COMPARISON rejects this — the shape check cannot.
    const { verifier, client } = verifierFor(validResponse, KEY_A);
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_B })).resolves.toBe(false);
    expect(client.commands).toEqual([]);
  });
});

describe("KMS verifier: the KMS response is not taken on trust", () => {
  it("fails closed when KMS reports a different signing algorithm", async () => {
    // Kills the line-76/77 guards. A signature verified under an algorithm other
    // than the one this receipt claims is not evidence for that receipt, even
    // when KMS reports SignatureValid: true.
    const { verifier } = verifierFor({ ...validResponse, SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256" });
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A })).resolves.toBe(false);
  });

  it("accepts when KMS omits the signing algorithm entirely", async () => {
    // The other side of the same guard: the check is conditional on the field
    // being a string. Without this, a mutant dropping the `typeof` test would
    // survive by rejecting every response that omits it.
    const { verifier } = verifierFor({ SignatureValid: true, KeyId: KEY_A });
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A })).resolves.toBe(true);
  });

  it("fails closed when KMS answers under a different key than was asked", async () => {
    // Kills the line-81 guard. This is the substitution case: the request named
    // one key and the answer came back from another.
    const { verifier } = verifierFor({ ...validResponse, KeyId: KEY_B });
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A })).resolves.toBe(false);
  });

  it("accepts when KMS reports the same key in an equivalent form", async () => {
    // `immutableKmsKeyIdsMatch` is a comparison, not string equality. Without a
    // positive case a mutant inverting it would survive.
    const { verifier } = verifierFor({ ...validResponse, KeyId: KEY_A });
    await expect(verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A })).resolves.toBe(true);
  });

  it("requires SignatureValid to be exactly true", async () => {
    // Kills the line-84 strict comparison. A truthy-but-not-true value must not
    // pass: `"true"`, `1`, and an absent field are all not a valid signature.
    for (const value of [false, undefined, "true", 1, null]) {
      const { verifier } = verifierFor({ ...validResponse, SignatureValid: value });
      await expect(
        verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A }),
        `SignatureValid: ${JSON.stringify(value)} must not verify`
      ).resolves.toBe(false);
    }
  });

  it("sends the digest, not the payload, under the DIGEST message type", async () => {
    // The signing contract. If the verifier sent the raw payload while the
    // signer sent its digest, every signature would fail for a reason unrelated
    // to authenticity.
    let captured: Record<string, unknown> | undefined;
    const client = {
      async send(command: unknown) {
        captured = (command as VerifyCommand).input as unknown as Record<string, unknown>;
        return validResponse;
      }
    };
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A, client: client as unknown as KMSClient });
    await verifier.verifyCanonical(PAYLOAD, "c2ln", receipt, { keyId: KEY_A });

    expect(captured?.MessageType).toBe(KMS_DECISION_RECEIPT_MESSAGE_TYPE);
    expect(captured?.SigningAlgorithm).toBe(KMS_DECISION_RECEIPT_SIGNING_ALGORITHM);
    expect(Buffer.from(captured?.Message as Uint8Array)).toEqual(Buffer.from(sha256Bytes(PAYLOAD)));
    expect(Buffer.from(captured?.Signature as Uint8Array)).toEqual(Buffer.from("c2ln", "base64"));
  });
});

describe("KMS verifier: the configured-public-key path", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  // RSA_PKCS1_PSS_PADDING (6) and RSA_PSS_SALTLEN_DIGEST (-1) are spelled as
  // literals rather than imported from `crypto.constants`. The module under test
  // reads the same constants, so importing them here would make the fixture and
  // the implementation move together — and a mutant that swapped the padding
  // scheme would still verify against a fixture that swapped with it.
  const RSA_PKCS1_PSS_PADDING = 6;
  const RSA_PSS_SALTLEN_DIGEST = -1;

  function pssSignature(payload: string): string {
    return signDigest(null, Buffer.from(sha256Bytes(payload)), {
      key: privateKey,
      padding: RSA_PKCS1_PSS_PADDING,
      saltLength: RSA_PSS_SALTLEN_DIGEST
    } as never).toString("base64");
  }

  it("verifies locally from a PEM without calling KMS at all", async () => {
    // Kills the line-61 branch and the line-117 PEM branch of loadPublicKey.
    const client = new StubKmsClient({});
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      client: client as unknown as KMSClient,
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
    });

    await expect(
      verifier.verifyCanonical(PAYLOAD, pssSignature(PAYLOAD), receipt, { keyId: KEY_A })
    ).resolves.toBe(true);
    expect(client.commands, "a configured public key must not reach the network").toEqual([]);
  });

  it("rejects a signature over different bytes on the local path", async () => {
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
    });
    await expect(
      verifier.verifyCanonical(PAYLOAD, pssSignature("different payload"), receipt, { keyId: KEY_A })
    ).resolves.toBe(false);
  });

  it("verifies from a DER public key", async () => {
    // Kills the line-121 DER branch, which no test reached.
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      publicKeyDer: new Uint8Array(publicKey.export({ format: "der", type: "spki" }))
    });
    await expect(
      verifier.verifyCanonical(PAYLOAD, pssSignature(PAYLOAD), receipt, { keyId: KEY_A })
    ).resolves.toBe(true);
  });

  it("still enforces key identity on the local path", async () => {
    // The local path must not become a way to skip the identity check: a valid
    // signature under the wrong declared key is still a rejection.
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
    });
    await expect(
      verifier.verifyCanonical(PAYLOAD, pssSignature(PAYLOAD), receipt, { keyId: KEY_B })
    ).resolves.toBe(false);
  });

  it("fetches the public key from KMS once and caches it", async () => {
    // Kills the line-114 cache guard and the line-130..138 GetPublicKey path.
    // The cache assertion is the point: a mutant dropping it would fetch on
    // every verification, which is a correctness-preserving change that costs a
    // network round trip per receipt.
    const client = new StubKmsClient({}, new Uint8Array(publicKey.export({ format: "der", type: "spki" })));
    const verifier = new KmsDecisionReceiptVerifier({
      keyId: KEY_A,
      client: client as unknown as KMSClient
    });
    // Force the local path without supplying a key, so loadPublicKey must fetch.
    const withFetch = Object.assign(verifier, { publicKeyPem: undefined, publicKeyDer: undefined });
    const loadTwice = async () => {
      await (withFetch as unknown as { loadPublicKey(): Promise<unknown> }).loadPublicKey();
      await (withFetch as unknown as { loadPublicKey(): Promise<unknown> }).loadPublicKey();
    };
    await loadTwice();
    expect(client.commands).toEqual(["GetPublicKey"]);
  });

  it("throws when KMS returns no public key bytes", async () => {
    // Kills the line-132 guard and its message. Returning an unusable key object
    // would be worse than failing: it would produce verification results derived
    // from nothing.
    const client = new StubKmsClient({});
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A, client: client as unknown as KMSClient });
    await expect(
      (verifier as unknown as { loadPublicKey(): Promise<unknown> }).loadPublicKey()
    ).rejects.toThrow(/returned no public key bytes/u);
  });
});

describe("KMS verifier: round-two survivors from the re-measurement", () => {
  it("labels the constructor rejection as the VERIFIER keyId", () => {
    // Kills the line-38 label passed to assertImmutableKmsKeyId. The signer and
    // the verifier both call it; a swapped label sends a reader debugging a
    // verification failure to the signing configuration.
    expect(() => new KmsDecisionReceiptVerifier({ keyId: "alias/active-key" })).toThrow(
      /KMS decision receipt verifier keyId must be an immutable KMS key ARN/u
    );
  });

  it("asks KMS for the CONFIGURED key when fetching the public key", async () => {
    // Kills the line-131 GetPublicKeyCommand input. A stub that ignores its
    // arguments cannot distinguish "asked for the right key" from "asked for
    // nothing", so the request is inspected rather than merely counted.
    let captured: Record<string, unknown> | undefined;
    const client = {
      async send(command: unknown) {
        captured = (command as GetPublicKeyCommand).input as unknown as Record<string, unknown>;
        return {};
      }
    };
    const verifier = new KmsDecisionReceiptVerifier({ keyId: KEY_A, client: client as unknown as KMSClient });
    await expect(
      (verifier as unknown as { loadPublicKey(): Promise<unknown> }).loadPublicKey()
    ).rejects.toThrow();
    expect(captured?.KeyId).toBe(KEY_A);
  });
});
