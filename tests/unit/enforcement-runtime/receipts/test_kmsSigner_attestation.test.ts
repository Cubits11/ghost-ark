import type { KMSClient, SignCommand, SignCommandOutput } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";

import {
  KMS_DECISION_RECEIPT_MESSAGE_TYPE,
  KMS_DECISION_RECEIPT_SIGNING_ALGORITHM,
  KmsDecisionReceiptSigner
} from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { sha256Bytes } from "../../../../packages/receipt-schema/src/hashCanonicalization";

/**
 * The Sign RESPONSE is an input, and until 2026-08-12 no test treated it as one.
 *
 * Every existing KMS test drives `signCanonical` through a fake client that
 * answers with a well-formed KeyId matching the request — so the three rejection
 * branches (no signature bytes, no immutable key attestation, attested identity
 * mismatch) had NO covering test at all, and E10 measured exactly that: 6
 * no-coverage mutants on those branch bodies plus 7 survivors on their guards
 * (kmsSigner.ts at 68.2%, the weakest file in the kernel).
 *
 * These branches are the custody boundary. `signCanonical` records whatever key
 * identity KMS attests (`this.keyId = responseKeyId`), so a signer that accepts
 * a mismatched or alias attestation silently re-binds every subsequent receipt
 * to a key nobody configured. The assertions below pin exact error messages on
 * purpose: which rejection fired IS the contract — "no attestation" and "wrong
 * attestation" are different custody failures and the mutants that survived
 * conflate them.
 */

const KEY_A_ARN = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000001";
const KEY_B_ARN = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000002";

const SIGNATURE_BYTES = new Uint8Array([1, 2, 3, 4]);

/** Minimal stub: answers every Sign with one configured response. */
function stubKms(response: Partial<SignCommandOutput>): { client: KMSClient; sent: SignCommand[] } {
  const sent: SignCommand[] = [];
  const client = {
    send: async (command: SignCommand) => {
      sent.push(command);
      return response;
    }
  } as unknown as KMSClient;
  return { client, sent };
}

describe("KmsDecisionReceiptSigner attests the response, not just the request", () => {
  it("signs when KMS attests the configured immutable key, and sends DIGEST parameters", async () => {
    const { client, sent } = stubKms({ KeyId: KEY_A_ARN, Signature: SIGNATURE_BYTES });
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client });

    const signature = await signer.signCanonical("canonical-payload");

    expect(signature).toBe(Buffer.from(SIGNATURE_BYTES).toString("base64"));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input).toMatchObject({
      KeyId: KEY_A_ARN,
      MessageType: KMS_DECISION_RECEIPT_MESSAGE_TYPE,
      SigningAlgorithm: KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
    });
    // The digest is computed HERE, not by the caller: what goes to KMS must be
    // the SHA-256 of the canonical payload, or the receipt binds to nothing.
    expect(Buffer.from(sent[0]?.input.Message ?? new Uint8Array())).toEqual(
      Buffer.from(sha256Bytes("canonical-payload"))
    );
  });

  it("rejects a response with no signature bytes, as that exact failure", async () => {
    // Killed mutants: the `!response.Signature` guard and its throw body.
    // Without them the miss surfaces later as `Buffer.from(undefined)` — a
    // TypeError with no custody meaning, in place of a fail-closed rejection.
    const { client } = stubKms({ KeyId: KEY_A_ARN });
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client });

    await expect(signer.signCanonical("payload")).rejects.toThrow(
      "KMS Sign returned no decision receipt signature bytes"
    );
  });

  it("rejects a response that attests no key identity at all", async () => {
    // Killed mutants: the `!responseKeyId` guard and its throw body. The mutant
    // path falls through to the identity-match check and reports "unexpected
    // key identity: undefined" — a wrong diagnosis: nothing was attested, which
    // is a different custody failure than the wrong thing being attested.
    const { client } = stubKms({ Signature: SIGNATURE_BYTES });
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client });

    await expect(signer.signCanonical("payload")).rejects.toThrow(
      "KMS Sign did not attest an immutable decision receipt key identity"
    );
  });

  it("rejects a response that attests a mutable alias instead of an immutable key", async () => {
    // Killed mutants: the `&&`→`||` and condition→true mutations in
    // immutableKeyIdFromSign. Under either, "alias/rotating-prod" is accepted
    // as an attested identity; under `||` the signer would then re-bind
    // this.keyId to an alias — the exact mutable-custody hole
    // assertImmutableKmsKeyId exists to close, reopened one field later.
    const { client } = stubKms({ KeyId: "alias/rotating-prod", Signature: SIGNATURE_BYTES });
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client });

    await expect(signer.signCanonical("payload")).rejects.toThrow(
      "KMS Sign did not attest an immutable decision receipt key identity"
    );
    expect(signer.keyId).toBe(KEY_A_ARN);
  });

  it("rejects an attestation by a different immutable key, and does not re-bind to it", async () => {
    // Killed mutants: the identity-match guard, its throw body, and the message
    // template. This is the sharpest survivor: with the guard inverted the
    // signer ACCEPTS a signature attested by KEY_B while configured for KEY_A,
    // silently sets this.keyId = KEY_B, and every receipt after that claims
    // custody under a key nobody chose — key substitution, unnoticed.
    const { client } = stubKms({ KeyId: KEY_B_ARN, Signature: SIGNATURE_BYTES });
    const signer = new KmsDecisionReceiptSigner({ keyId: KEY_A_ARN, client });

    await expect(signer.signCanonical("payload")).rejects.toThrow(
      `KMS Sign attested an unexpected decision receipt key identity: ${KEY_B_ARN}`
    );
    expect(signer.keyId).toBe(KEY_A_ARN);
  });

  /*
   * One mutant is left alive deliberately, with the argument (E10 discipline):
   * `typeof response.KeyId === "string"` → `true` in immutableKeyIdFromSign.
   * Within the SDK's contract KeyId is `string | undefined`, and
   * isImmutableKmsKeyId coerces undefined to "undefined", which matches neither
   * key pattern — so for every value the SDK can deliver, the mutant and the
   * original return the same result. Separating them requires a non-string
   * wrapper object whose coercion IS a key id (e.g. `new String(uuid)`), which
   * the transport layer cannot produce. Equivalent within the type contract;
   * a test built on that input would pin a fiction.
   */
  it("names the rejected field when constructed with a non-immutable keyId", () => {
    // Killed mutant: the constructor's context label → "". The message must say
    // WHICH identifier was rejected; an operator holding several key ids gets
    // " must be an immutable KMS key ARN..." with no subject otherwise.
    expect(() => new KmsDecisionReceiptSigner({ keyId: "alias/active-key" })).toThrow(
      /KMS decision receipt signer keyId must be an immutable KMS key ARN or key UUID/u
    );
  });
});
