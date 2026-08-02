import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_CONTEXT_HASH,
  DEFAULT_EXECUTION_NONCE,
  assertNonDefaultExecutionBoundary,
  buildUnsignedDecisionReceipt,
  createExecutionNonce,
  isDefaultExecutionBoundary,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import type { UnsignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";

/**
 * Branch tests for receipt canonicalization, written against experiment E10's
 * report.
 *
 * `canonical.ts` scored 61.0% covered (47/77) with **58 of its 135 mutants
 * executed by no test at all** — the largest coverage hole in the trust kernel.
 * `CLAUDE.md` names this file first under "Be careful with".
 *
 * As everywhere else in this kernel, the unreached code is the guards:
 * `assertString`, `assertNonEmptyString`, `assertDigestShape`,
 * `assertExecutionNonceShape`, the `createExecutionNonce` bounds, and the two
 * execution-boundary assertions that exist to stop a development default from
 * reaching a production receipt.
 *
 * That last pair matters most. A receipt carrying
 * `DEFAULT_EXECUTION_CONTEXT_HASH` or `DEFAULT_EXECUTION_NONCE` is one whose
 * execution boundary was never established — it looks signed and bounded while
 * binding nothing. The guard against that was unexecuted.
 */

function receiptInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY",
    ...overrides
  } as never;
}

describe("canonical: digest helpers validate their inputs", () => {
  it("computes stable digests for well-formed input", () => {
    // The control arm.
    expect(publicSha256Digest("hello")).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(privateHmacDigest("secret", "hello")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(publicSha256Digest("hello")).toBe(publicSha256Digest("hello"));
    expect(privateHmacDigest("secret", "hello")).not.toBe(privateHmacDigest("other", "hello"));
  });

  it("accepts the empty string as a value but not as a secret", () => {
    // The two helpers use DIFFERENT assertions — `assertString` for values,
    // `assertNonEmptyString` for the HMAC secret. Without this pair, a mutant
    // swapping one for the other survives: an empty secret would silently produce
    // an unkeyed digest that still looks like an HMAC.
    expect(publicSha256Digest("")).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(privateHmacDigest("secret", "")).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(() => privateHmacDigest("", "value")).toThrow(/secret must be a non-empty string/u);
  });

  it("rejects a non-string value", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => publicSha256Digest(bad as unknown as string), String(bad)).toThrow(/value must be a string/u);
      expect(() => privateHmacDigest("secret", bad as unknown as string), String(bad)).toThrow(/value must be a string/u);
    }
  });
});

describe("canonical: execution nonce generation is bounded", () => {
  it("produces a base64url nonce of the requested strength", () => {
    const nonce = createExecutionNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(createExecutionNonce()).not.toBe(nonce);
  });

  it("accepts the declared byte-length bounds and rejects outside them", () => {
    // Kills the `bytes < 18 || bytes > 96` guard. 18 bytes is 144 bits of
    // entropy; below that the nonce stops being a meaningful uniqueness
    // commitment, which is the whole reason it is in the signed payload.
    expect(() => createExecutionNonce(18)).not.toThrow();
    expect(() => createExecutionNonce(96)).not.toThrow();
    expect(() => createExecutionNonce(17)).toThrow(/between 18 and 96/u);
    expect(() => createExecutionNonce(97)).toThrow(/between 18 and 96/u);
  });

  it("rejects a non-integer byte length", () => {
    for (const bad of [32.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => createExecutionNonce(bad), String(bad)).toThrow(/safe integer/u);
    }
  });
});

describe("canonical: the execution boundary must not be a development default", () => {
  const nonDefault = {
    execution_context_hash: `sha256:${"1".repeat(64)}`,
    execution_nonce: createExecutionNonce()
  };

  it("recognizes a receipt that established a real execution boundary", () => {
    const receipt = buildUnsignedDecisionReceipt(receiptInput(nonDefault));
    expect(isDefaultExecutionBoundary(receipt)).toBe(false);
    expect(() => assertNonDefaultExecutionBoundary(receipt)).not.toThrow();
  });

  it("flags EITHER default, not only both together", () => {
    // `isDefaultExecutionBoundary` is a disjunction. Testing only the
    // both-defaults case leaves a mutant that turns `||` into `&&` alive — and
    // that mutant would pass a receipt whose nonce was real but whose context
    // hash was never computed.
    const defaultHash = buildUnsignedDecisionReceipt(
      receiptInput({ ...nonDefault, execution_context_hash: DEFAULT_EXECUTION_CONTEXT_HASH })
    );
    const defaultNonce = buildUnsignedDecisionReceipt(
      receiptInput({ ...nonDefault, execution_nonce: DEFAULT_EXECUTION_NONCE })
    );

    expect(isDefaultExecutionBoundary(defaultHash)).toBe(true);
    expect(isDefaultExecutionBoundary(defaultNonce)).toBe(true);
  });

  it("refuses a default execution_context_hash by name", () => {
    const receipt = buildUnsignedDecisionReceipt(
      receiptInput({ ...nonDefault, execution_context_hash: DEFAULT_EXECUTION_CONTEXT_HASH })
    );
    expect(() => assertNonDefaultExecutionBoundary(receipt)).toThrow(/must not use the default execution_context_hash/u);
  });

  it("refuses a default execution_nonce by name", () => {
    // The two throws carry different field names. Asserting only "it throws"
    // leaves a mutant that reports the wrong field alive, and a boundary error
    // naming the wrong field sends the next reader to the wrong place.
    const receipt = buildUnsignedDecisionReceipt(
      receiptInput({ ...nonDefault, execution_nonce: DEFAULT_EXECUTION_NONCE })
    );
    expect(() => assertNonDefaultExecutionBoundary(receipt)).toThrow(/must not use the default local-dev execution_nonce/u);
  });
});

describe("canonical: receipt construction validates its fields", () => {
  it("accepts both sha256 and hmac-sha256 input digests", () => {
    // `input_digest` is checked against a DIFFERENT pattern depending on its
    // prefix. Only exercising one branch leaves the other's mutants alive.
    expect(() =>
      buildUnsignedDecisionReceipt(receiptInput({ input_digest: `sha256:${"a".repeat(64)}` }))
    ).not.toThrow();
    expect(() =>
      buildUnsignedDecisionReceipt(receiptInput({ input_digest: `hmac-sha256:${"a".repeat(64)}` }))
    ).not.toThrow();
  });

  it("rejects a malformed input digest under either prefix", () => {
    for (const digest of [
      `sha256:${"a".repeat(63)}`,
      `sha256:${"A".repeat(64)}`,
      `hmac-sha256:${"a".repeat(63)}`,
      `hmac-sha256:${"Z".repeat(64)}`,
      "a".repeat(64)
    ]) {
      expect(() => buildUnsignedDecisionReceipt(receiptInput({ input_digest: digest })), digest).toThrow(
        /input_digest has an invalid digest shape/u
      );
    }
  });

  it("validates execution_context_hash only when supplied", () => {
    // The `!== undefined` guard. Absent is legal — the default is applied — but
    // a supplied value must be a well-formed sha256 digest.
    expect(() => buildUnsignedDecisionReceipt(receiptInput({ execution_context_hash: undefined }))).not.toThrow();
    expect(() =>
      buildUnsignedDecisionReceipt(receiptInput({ execution_context_hash: "sha256:nope" }))
    ).toThrow(/execution_context_hash has an invalid digest shape/u);
  });

  it("rejects an execution nonce outside the declared shape", () => {
    // Kills the executionNoncePattern mutants: 8-256 chars of [A-Za-z0-9._:-].
    for (const nonce of ["short", "a".repeat(257), "has spaces", "has/slash", ""]) {
      expect(() => buildUnsignedDecisionReceipt(receiptInput({ execution_nonce: nonce })), JSON.stringify(nonce)).toThrow(
        /execution_nonce must be 8-256 characters/u
      );
    }
    expect(() => buildUnsignedDecisionReceipt(receiptInput({ execution_nonce: "a".repeat(8) }))).not.toThrow();
    expect(() => buildUnsignedDecisionReceipt(receiptInput({ execution_nonce: "a".repeat(256) }))).not.toThrow();
  });

  it("sorts action_taken so receipt identity does not depend on emission order", () => {
    // Kills the line-144 sort. Two receipts recording the same actions in a
    // different order must be one receipt, not two — this is the same
    // normalization argument as object-key ordering in the canonicalizer.
    const ascending = buildUnsignedDecisionReceipt(receiptInput({ action_taken: ["a_first", "z_last"] }));
    const descending = buildUnsignedDecisionReceipt(receiptInput({ action_taken: ["z_last", "a_first"] }));

    expect(ascending.action_taken).toEqual(["a_first", "z_last"]);
    expect(descending.action_taken).toEqual(["a_first", "z_last"]);
    expect(ascending.receipt_id).toBe(descending.receipt_id);
  });

  it("does not mutate the caller's action_taken array", () => {
    // The spread before the sort. Sorting in place would reorder the caller's
    // array as a side effect of building a receipt.
    const caller = ["z_last", "a_first"];
    buildUnsignedDecisionReceipt(receiptInput({ action_taken: caller }));
    expect(caller).toEqual(["z_last", "a_first"]);
  });

  it("rejects an empty required string field", () => {
    // Rejected by the zod schema, NOT by canonical.ts's own assertNonEmptyString.
    // The first version of this test asserted the canonicalization message and
    // failed: `buildUnsignedDecisionReceipt` only calls `assertDigestShape` and
    // `assertExecutionNonceShape` directly, and the string helpers are reachable
    // only through `publicSha256Digest` / `privateHmacDigest`. Recorded because
    // guessing which layer rejects an input is exactly the mistake that leaves a
    // guard untested while looking covered.
    for (const field of ["request_id", "model_id", "policy_version"]) {
      expect(() => buildUnsignedDecisionReceipt(receiptInput({ [field]: "" })), field).toThrow();
    }
  });

  it("sorts retrieved_context_digests without mutating the caller's array", () => {
    // Same normalization argument as action_taken: the ORDER in which context
    // was retrieved is not part of what the receipt asserts, so it must not
    // change receipt identity.
    const caller = [`sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`];
    const forward = buildUnsignedDecisionReceipt(receiptInput({ retrieved_context_digests: [...caller] }));
    const reversed = buildUnsignedDecisionReceipt(
      receiptInput({ retrieved_context_digests: [...caller].reverse() })
    );

    expect(forward.retrieved_context_digests).toEqual([`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`]);
    expect(forward.receipt_id).toBe(reversed.receipt_id);
    expect(caller[0]).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("gives byte-identical receipt ids for identical content", () => {
    const a = buildUnsignedDecisionReceipt(receiptInput()) as UnsignedDecisionReceipt;
    const b = buildUnsignedDecisionReceipt(receiptInput()) as UnsignedDecisionReceipt;
    expect(a.receipt_id).toBe(b.receipt_id);
    expect(a.receipt_id).toMatch(/^grct_[a-f0-9]{64}$/u);
  });
});
