import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_NONCE,
  buildUnsignedDecisionReceipt,
  createExecutionNonce,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
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
