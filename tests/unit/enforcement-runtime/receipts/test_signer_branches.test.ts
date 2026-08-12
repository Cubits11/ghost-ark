import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_NONCE,
  buildUnsignedDecisionReceipt,
  createExecutionNonce,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { ValidationError } from "../../../../packages/shared/src/errors";
import {
  LocalDevHmacReceiptSigner,
  buildDecisionReceiptSignatureEnvelope,
  decodeDecisionReceiptSignatureEnvelope,
  encodeDecisionReceiptSignatureEnvelope,
  signDecisionReceipt,
  type DecisionReceiptSignatureEnvelope,
  type DecisionReceiptSigner
} from "../../../../packages/enforcement-runtime/src/receipts/signer";

/**
 * Branch tests for the decision-receipt signature envelope, written against
 * experiment E10's report.
 *
 * `signer.ts` scored 61.4% covered (105/171) with **46 of its 217 mutants
 * executed by no test at all**. The unreached code is the envelope *parser* —
 * the routine that decides whether a `receipt_signature` string is a legitimate
 * envelope before anything verifies against it.
 *
 * That parser is the widest attack surface in the file. A receipt's signature
 * envelope is attacker-supplied data on the verification path: it arrives as
 * base64url text and is decoded, shape-checked, and then trusted. Every check it
 * performs — exact key set, schema version, algorithm allowlist, digest shape,
 * base64 shape — was reachable only through the happy path, so a mutant removing
 * any of them survived.
 *
 * `signDecisionReceipt` is also where the execution-boundary rule is applied to
 * KMS receipts specifically, and that branch was unexecuted too.
 */

const KMS_ALG = "KMS_SIGN_RSASSA_PSS_SHA_256";
const HMAC_ALG = "LOCAL_HMAC_SHA256_DEV_ONLY";

function receipt(overrides: Record<string, unknown> = {}) {
  return buildUnsignedDecisionReceipt({
    request_id: "request-a",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-07T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "d".repeat(64),
    input_digest: publicSha256Digest("request-a"),
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
    signature_alg: HMAC_ALG,
    ...overrides
  } as never);
}

const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });

function validEnvelope(overrides: Partial<DecisionReceiptSignatureEnvelope> = {}): DecisionReceiptSignatureEnvelope {
  return {
    schemaVersion: "ghost.decision_receipt_signature.v1",
    keyId: "local-dev-hmac",
    algorithm: HMAC_ALG,
    digestSha256: "a".repeat(64),
    signature: Buffer.from("signature-bytes").toString("base64"),
    ...overrides
  } as DecisionReceiptSignatureEnvelope;
}

describe("signer: the envelope round-trips and its shape is enforced", () => {
  it("encodes and decodes a well-formed envelope unchanged", () => {
    // The control arm for every rejection below.
    const envelope = validEnvelope();
    expect(decodeDecisionReceiptSignatureEnvelope(encodeDecisionReceiptSignatureEnvelope(envelope))).toEqual(envelope);
  });

  it("rejects an envelope that is not unpadded base64url", () => {
    for (const bad of ["not base64url!", "has=padding", "has+plus", "has/slash", ""]) {
      expect(() => decodeDecisionReceiptSignatureEnvelope(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("rejects an envelope that decodes to something other than an object", () => {
    // Kills the line-165 guard. An array passes `typeof === "object"`, which is
    // why the check names arrays explicitly.
    for (const payload of ["[]", '"a string"', "42", "null", "true"]) {
      const encoded = Buffer.from(payload, "utf8").toString("base64url");
      expect(() => decodeDecisionReceiptSignatureEnvelope(encoded), payload).toThrow(/must decode to an object/u);
    }
  });

  it("rejects an envelope that is not valid JSON", () => {
    const encoded = Buffer.from("{not json", "utf8").toString("base64url");
    expect(() => decodeDecisionReceiptSignatureEnvelope(encoded)).toThrow(/base64url-encoded JSON/u);
  });

  it("rejects an envelope with an unexpected field set, in both directions", () => {
    // Kills the exact-key-set check. An EXTRA field is the smuggling case: data
    // that travels inside a signed-looking envelope while no check reads it. A
    // MISSING field is the truncation case.
    const withExtra = { ...validEnvelope(), extra: "smuggled" };
    const withMissing = { ...validEnvelope() } as Record<string, unknown>;
    delete withMissing.keyId;

    for (const payload of [withExtra, withMissing]) {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      expect(() => decodeDecisionReceiptSignatureEnvelope(encoded)).toThrow(/unexpected field set/u);
    }
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ schemaVersion: "ghost.v2" } as never))).toThrow(
      /unsupported schemaVersion/u
    );
  });

  it("rejects an algorithm outside the allowlist and accepts both inside it", () => {
    // Kills the `!== hmac && !== kms` conjunction. Testing only one accepted
    // algorithm leaves a mutant that drops the other alive.
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ algorithm: "ROT13" } as never))).toThrow(
      /Unsupported decision receipt signature algorithm/u
    );
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ algorithm: HMAC_ALG } as never))).not.toThrow();
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ algorithm: KMS_ALG } as never))).not.toThrow();
  });

  it("rejects a keyId that is empty or not a string", () => {
    for (const keyId of ["", 42, null, undefined]) {
      expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ keyId } as never)), String(keyId)).toThrow();
    }
  });

  it("requires digestSha256 to be lowercase 64-hex", () => {
    // Kills the lowerSha256HexPattern mutants. Uppercase is the interesting case:
    // it is a valid hex digest that is not the canonical spelling, so accepting
    // it would let one digest have two envelope representations.
    for (const digest of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `sha256:${"a".repeat(64)}`, "", 42]) {
      expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ digestSha256: digest } as never)), String(digest)).toThrow();
    }
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ digestSha256: "a".repeat(64) }))).not.toThrow();
  });

  it("requires the signature to be standard base64 that decodes to bytes", () => {
    // Kills the standardBase64Pattern and the zero-byte decode check. base64url
    // is deliberately NOT accepted here: the envelope field is standard base64,
    // and accepting both would give one signature two spellings.
    for (const signature of ["", "not base64!", "a", "====", "ab-cd_ef", 42, null]) {
      expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope({ signature } as never)), String(signature)).toThrow();
    }
    expect(() => encodeDecisionReceiptSignatureEnvelope(validEnvelope())).not.toThrow();
  });
});

describe("signer: the signer itself is validated", () => {
  it("rejects a non-object signer", () => {
    for (const bad of [null, undefined, "signer", 42]) {
      expect(() => buildDecisionReceiptSignatureEnvelope(receipt(), bad as unknown as DecisionReceiptSigner), String(bad)).toThrow(
        /signer must be an object/u
      );
    }
  });

  it("rejects a signer with an empty keyId", () => {
    const bad = { algorithm: HMAC_ALG, keyId: "", signCanonical: () => "AAAA" } as unknown as DecisionReceiptSigner;
    expect(() => buildDecisionReceiptSignatureEnvelope(receipt(), bad)).toThrow(/keyId must be a non-empty string/u);
  });

  it("rejects a signer that cannot sign", () => {
    const bad = { algorithm: HMAC_ALG, keyId: "k", signCanonical: "nope" } as unknown as DecisionReceiptSigner;
    expect(() => buildDecisionReceiptSignatureEnvelope(receipt(), bad)).toThrow(/must expose signCanonical/u);
  });

  it("rejects a signature the signer returned in the wrong shape", () => {
    const bad = { algorithm: HMAC_ALG, keyId: "k", signCanonical: () => "not base64!" } as unknown as DecisionReceiptSigner;
    expect(() => buildDecisionReceiptSignatureEnvelope(receipt(), bad)).toThrow(/standard base64/u);
  });

  it("refuses to sign when the receipt's algorithm disagrees with the signer's", () => {
    // The receipt declares which algorithm signed it. If that field and the
    // actual signer disagree, the receipt asserts something false about its own
    // provenance — regardless of whether the signature itself is valid.
    expect(() => buildDecisionReceiptSignatureEnvelope(receipt({ signature_alg: KMS_ALG }), signer)).toThrow(
      /does not match signer algorithm/u
    );
  });
});

describe("signer: KMS receipts must carry a real execution boundary", () => {
  const kmsSigner = {
    algorithm: KMS_ALG,
    keyId: "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-00000000000a",
    signCanonical: () => Buffer.from("kms-signature").toString("base64")
  } as unknown as DecisionReceiptSigner;

  it("refuses a KMS receipt still carrying the local-dev execution nonce", () => {
    // Kills the `signer.algorithm === kmsRsaPssAlgorithm` branch. KMS signing is
    // the intended production mode, so a KMS receipt whose execution boundary is
    // still the development default is signed evidence that binds nothing.
    expect(() =>
      buildDecisionReceiptSignatureEnvelope(
        // A real context hash, so the nonce is the ONLY default left — the
        // context-hash check runs first and would otherwise mask it.
        receipt({
          signature_alg: KMS_ALG,
          execution_context_hash: `sha256:${"1".repeat(64)}`,
          execution_nonce: DEFAULT_EXECUTION_NONCE
        }),
        kmsSigner
      )
    ).toThrow(/must not use the default local-dev execution_nonce/u);
  });

  it("refuses a KMS receipt still carrying the default execution_context_hash", () => {
    // The other default, checked first and reported under its own field name.
    expect(() =>
      buildDecisionReceiptSignatureEnvelope(
        receipt({ signature_alg: KMS_ALG, execution_nonce: createExecutionNonce() }),
        kmsSigner
      )
    ).toThrow(/must not use the default execution_context_hash/u);
  });

  it("accepts a KMS receipt with a real execution boundary", () => {
    const envelope = buildDecisionReceiptSignatureEnvelope(
      receipt({
        signature_alg: KMS_ALG,
        execution_nonce: createExecutionNonce(),
        execution_context_hash: `sha256:${"1".repeat(64)}`
      }),
      kmsSigner
    );
    expect(envelope.algorithm).toBe(KMS_ALG);
  });

  it("does NOT apply the boundary rule to local HMAC receipts", () => {
    // The conjunction's other side. Local-dev signing is allowed to use the
    // local-dev default; a mutant dropping the algorithm test would break every
    // development receipt.
    expect(() =>
      buildDecisionReceiptSignatureEnvelope(receipt({ execution_nonce: DEFAULT_EXECUTION_NONCE }), signer)
    ).not.toThrow();
  });
});

describe("signer: end-to-end signing binds the digest it claims", () => {
  it("puts the receipt's own digest in the envelope", () => {
    // A mutant substituting any other digest would still produce a
    // structurally-valid envelope, so the binding itself is asserted.
    const unsigned = receipt();
    const signed = signDecisionReceipt(unsigned, signer);
    const envelope = decodeDecisionReceiptSignatureEnvelope(signed.receipt_signature);

    expect(envelope.digestSha256).toBe(decisionReceiptDigest(unsigned).replace(/^sha256:/u, ""));
    expect(envelope.keyId).toBe(signer.keyId);
    expect(envelope.algorithm).toBe(HMAC_ALG);
  });

  it("verifies its own signature and rejects one over different bytes", () => {
    const unsigned = receipt();
    const signed = signDecisionReceipt(unsigned, signer);
    const envelope = decodeDecisionReceiptSignatureEnvelope(signed.receipt_signature);
    const other = signDecisionReceipt(receipt({ request_id: "request-b" }), signer);
    const otherEnvelope = decodeDecisionReceiptSignatureEnvelope(other.receipt_signature);

    expect(envelope.signature).not.toBe(otherEnvelope.signature);
  });
});

/**
 * The rejection CONTRACT: which message, which field, which context.
 *
 * Written against E10's re-measure of 2026-08-12: 57 of signer.ts's 213 mutants
 * survived, and almost all of them mutate the diagnostic surface — an error
 * message to "", a context object to {}, a field label away — or a guard whose
 * removal changes WHICH rejection fires rather than WHETHER one does. The tests
 * above assert only that something throws matching a loose pattern, so those
 * edits ship silently.
 *
 * That surface is not cosmetic here. `ValidationError.context` is the
 * machine-readable half of every rejection (`errorResponse` serializes it to
 * callers), and the message says which admission rule refused the envelope. A
 * verifier that rejects for the WRONG stated reason still rejects — and then an
 * operator "fixes" the wrong thing, or a client retries what can never succeed.
 * So each case pins: the exact message, the domain, and the context fields.
 *
 * The key-set cases are the sharp ones. The earlier "both directions" test
 * deleted `keyId`, whose removal SHIFTS the sorted key list, so the
 * element-wise mismatch still fired; deleting the LAST key (`signature`)
 * leaves a clean prefix that only the length clause catches, and renaming a
 * key ("keyid") preserves length so only the element-wise clause catches it.
 * Each clause of `length !== || some(...)` needs the input only IT rejects —
 * otherwise the `||`→`&&` and `some`→`every` mutants survive, and an envelope
 * with a truncated or renamed field slides through to a misleading later error.
 */
describe("signer: rejections state the right reason, field, and context", () => {
  const DOMAIN = "ghost_ark.decision_receipt_signer.v1";

  function encodeRaw(payload: unknown): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  function caughtFrom(act: () => unknown): ValidationError {
    let caught: unknown;
    try {
      act();
    } catch (error) {
      caught = error;
    }
    expect(caught, "expected a ValidationError").toBeInstanceOf(ValidationError);
    return caught as ValidationError;
  }

  interface RejectionCase {
    readonly name: string;
    readonly act: () => unknown;
    readonly message: string;
    readonly context: Record<string, unknown>;
  }

  const noSignature = (): Record<string, unknown> => {
    const envelope = { ...validEnvelope() } as Record<string, unknown>;
    delete envelope.signature;
    return envelope;
  };

  const renamedKey = (): Record<string, unknown> => {
    const envelope = { ...validEnvelope() } as Record<string, unknown>;
    envelope.keyid = envelope.keyId;
    delete envelope.keyId;
    return envelope;
  };

  const cases: readonly RejectionCase[] = [
    {
      name: "an empty receipt_signature",
      act: () => decodeDecisionReceiptSignatureEnvelope(""),
      message: "receipt_signature must be a non-empty string.",
      context: { field: "receipt_signature" }
    },
    {
      // Kills the LEFT-OPERAND mutant of the non-empty-string guard
      // (`typeof value !== "string"` → false): a number slides past the type
      // check, coerces through the base64url regex, and dies inside
      // Buffer.from as a TypeError — an unclassified crash on the public
      // decode path in place of a fail-closed rejection.
      name: "a non-string receipt_signature",
      act: () => decodeDecisionReceiptSignatureEnvelope(42 as unknown as string),
      message: "receipt_signature must be a non-empty string.",
      context: { field: "receipt_signature" }
    },
    {
      // Kills the base64url ANCHOR mutant: with `^` dropped, "!!!abc" matches
      // by suffix and the junk reaches the JSON parser wearing a different error.
      name: "leading junk before base64url text",
      act: () => decodeDecisionReceiptSignatureEnvelope("!!!abc"),
      message: "receipt_signature must be unpadded base64url text.",
      context: { field: "receipt_signature" }
    },
    {
      name: "base64url text that is not JSON",
      act: () => decodeDecisionReceiptSignatureEnvelope(Buffer.from("{not json", "utf8").toString("base64url")),
      message: "receipt_signature must be a base64url-encoded JSON signature envelope.",
      context: { field: "receipt_signature" }
    },
    {
      name: "a decoded non-object",
      act: () => decodeDecisionReceiptSignatureEnvelope(Buffer.from("42", "utf8").toString("base64url")),
      message: "receipt_signature envelope must decode to an object.",
      context: { field: "receipt_signature" }
    },
    {
      // Deleting the LAST sorted key: the surviving prefix matches expected
      // element-wise, so ONLY the length clause rejects it.
      name: "an envelope missing its final key",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw(noSignature())),
      message: "receipt_signature envelope contains an unexpected field set.",
      context: {
        field: "receipt_signature",
        expected: ["algorithm", "digestSha256", "keyId", "schemaVersion", "signature"],
        observed: ["algorithm", "digestSha256", "keyId", "schemaVersion"]
      }
    },
    {
      // Same length, one renamed key: ONLY the element-wise clause rejects it.
      name: "an envelope with a renamed key",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw(renamedKey())),
      message: "receipt_signature envelope contains an unexpected field set.",
      context: {
        field: "receipt_signature",
        expected: ["algorithm", "digestSha256", "keyId", "schemaVersion", "signature"],
        observed: ["algorithm", "digestSha256", "keyid", "schemaVersion", "signature"]
      }
    },
    {
      name: "an unsupported schemaVersion",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), schemaVersion: "ghost.v2" })),
      message: "receipt_signature envelope has an unsupported schemaVersion.",
      context: { field: "schemaVersion", observed: "ghost.v2" }
    },
    {
      name: "an algorithm outside the allowlist",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), algorithm: "ROT13" })),
      message: "Unsupported decision receipt signature algorithm.",
      context: { field: "algorithm", observed: "ROT13" }
    },
    {
      name: "an empty envelope keyId",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), keyId: "" })),
      message: "receipt_signature envelope keyId must be non-empty.",
      context: { field: "keyId" }
    },
    {
      name: "a non-string digestSha256",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), digestSha256: 42 })),
      message: "receipt_signature envelope digestSha256 must be a string.",
      context: { field: "digestSha256" }
    },
    {
      name: "an uppercase digestSha256",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), digestSha256: "A".repeat(64) })),
      message: "digestSha256 must be a lowercase SHA-256 hex digest.",
      context: { field: "digestSha256" }
    },
    {
      name: "a non-string signature",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), signature: 42 })),
      message: "receipt_signature envelope signature must be a string.",
      context: { field: "signature" }
    },
    {
      name: "an empty signature",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), signature: "" })),
      message: "signature must be a non-empty string.",
      context: { field: "signature" }
    },
    {
      // Kills the base64 GROUPING mutant `{4}`→``: "AAAAA" is five characters,
      // which no combination of 4-character groups plus a padded tail produces.
      // Buffer.from decodes it leniently anyway — the regex is the only guard.
      name: "a signature with a truncated base64 group",
      act: () => decodeDecisionReceiptSignatureEnvelope(encodeRaw({ ...validEnvelope(), signature: "AAAAA" })),
      message: "signature must be standard base64-encoded bytes.",
      context: { field: "signature" }
    },
    {
      name: "a non-object signer",
      act: () => buildDecisionReceiptSignatureEnvelope(receipt(), null as unknown as DecisionReceiptSigner),
      message: "Decision receipt signer must be an object.",
      context: { field: "signer" }
    },
    {
      name: "a signer without signCanonical",
      act: () =>
        buildDecisionReceiptSignatureEnvelope(receipt(), {
          algorithm: HMAC_ALG,
          keyId: "k",
          signCanonical: "nope"
        } as unknown as DecisionReceiptSigner),
      message: "Decision receipt signer must expose signCanonical().",
      context: { field: "signCanonical" }
    },
    {
      name: "an HMAC signer built with an empty secret",
      act: () => new LocalDevHmacReceiptSigner({ secret: "" }),
      message: "secret must be a non-empty string.",
      context: { field: "secret" }
    },
    {
      name: "an HMAC signer built with an empty keyId",
      act: () => new LocalDevHmacReceiptSigner({ secret: "s", keyId: "" }),
      message: "keyId must be a non-empty string.",
      context: { field: "keyId" }
    },
    {
      name: "signing an empty canonical payload",
      act: () => signer.signCanonical(""),
      message: "canonicalPayload must be a non-empty string.",
      context: { field: "canonicalPayload" }
    },
    {
      name: "verifying an empty canonical payload",
      act: () => signer.verifyCanonical("", Buffer.from("sig").toString("base64")),
      message: "canonicalPayload must be a non-empty string.",
      context: { field: "canonicalPayload" }
    },
    {
      name: "an algorithm mismatch between receipt and signer",
      act: () => buildDecisionReceiptSignatureEnvelope(receipt({ signature_alg: KMS_ALG }), signer),
      message: `Receipt signature_alg ${KMS_ALG} does not match signer algorithm ${HMAC_ALG}`,
      context: { receiptAlgorithm: KMS_ALG, signerAlgorithm: HMAC_ALG }
    }
  ];

  for (const rejection of cases) {
    it(`rejects ${rejection.name} with its exact reason and context`, () => {
      const caught = caughtFrom(rejection.act);
      expect(caught.message).toBe(rejection.message);
      expect(caught.context).toMatchObject({ domain: DOMAIN, ...rejection.context });
    });
  }

  it("records the parse failure's cause so the rejection is diagnosable", () => {
    const caught = caughtFrom(() =>
      decodeDecisionReceiptSignatureEnvelope(Buffer.from("{not json", "utf8").toString("base64url"))
    );
    expect(typeof caught.context.cause).toBe("string");
    expect((caught.context.cause as string).length).toBeGreaterThan(0);
  });

  it("returns false, not a throw, when signature lengths differ", () => {
    // timingSafeEqual THROWS on unequal lengths; the length guard is what turns
    // an attacker-chosen short signature into a clean false instead of a crash
    // on the verification path.
    expect(signer.verifyCanonical("payload", Buffer.from("short").toString("base64"))).toBe(false);
  });

  /*
   * Survivors NOT chased, with the argument (E10 discipline: every survivor
   * gets a disposition, and an equivalent one gets its equivalence written
   * down rather than a test that pretends to kill it):
   *
   * - `expected.sort()` removal (line 96): the literal is already written in
   *   sorted order, so the call is a no-op. Equivalent.
   * - `decoded.length === 0` (line 80): unreachable — assertNonEmptyString and
   *   the standard-base64 pattern have already rejected every string that
   *   decodes to zero bytes ("" is the only one). Equivalent under the guards.
   * - Buffer encoding literals "base64"/"utf8" → "" (lines 79, 149): Node
   *   normalizes an empty encoding to utf8; for line 79 the decode feeds only
   *   the unreachable zero-length check above. No observable difference.
   * - `typeof value !== "string"` clauses reached only with strings: the
   *   non-string arms are exercised where an input can actually be non-string
   *   (envelope fields); signer-internal call sites always pass strings.
   */
});
