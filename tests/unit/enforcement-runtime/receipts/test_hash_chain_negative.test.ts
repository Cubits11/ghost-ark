import { describe, expect, it } from "vitest";

import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest,
  signedDecisionReceiptHash
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { verifyDecisionReceiptChain } from "../../../../packages/enforcement-runtime/src/receipts/chain";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";

/**
 * Negative-path tests for the receipt hash chain, written against experiment
 * E10's coverage report.
 *
 * `chain.ts` scored 81.7% on its covered mutants but **28 of its 88 mutants had
 * no coverage at all** — a third of the module executed by no test in the
 * declared scope. The uncovered lines were not incidental: every one of them is
 * a *detection*. Non-array input, empty chain, duplicate signed-receipt hash,
 * a first receipt that wrongly declares a predecessor, a missing prior receipt,
 * a timestamp that moves backwards, and the hash-chain break message itself.
 *
 * The existing suite establishes that a well-formed chain PASSES. Nothing
 * established that a broken one FAILS. That is the control-arm problem this
 * repository already states for detection benchmarks — "no detection rate
 * without a control arm" — applied to the chain verifier: a verifier that
 * accepts everything passes every happy-path test ever written.
 *
 * Each test below asserts BOTH that the check fails and which failure it
 * reports, because a chain verifier that rejects a tampered chain for the wrong
 * reason has not actually detected the tamper.
 */

function buildReceipt(
  prev_receipt_hash: string | null,
  request_id: string,
  overrides: Partial<{ tenantId: string; timestamp: string }> = {}
) {
  return buildUnsignedDecisionReceipt({
    request_id,
    tenant_id_hash: privateHmacDigest("secret", overrides.tenantId ?? "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: overrides.timestamp ?? "2026-07-07T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "d".repeat(64),
    input_digest: publicSha256Digest(request_id),
    retrieved_context_digests: [],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 10,
    cost_estimate_usd: 0,
    prev_receipt_hash,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
  });
}

const signer = new LocalDevHmacReceiptSigner({ secret: "local-secret" });

function sign(receipt: ReturnType<typeof buildReceipt>) {
  return signDecisionReceipt(receipt, signer);
}

/** A valid two-receipt chain, used as the control for every tamper below. */
function validChain(): unknown[] {
  const first = sign(buildReceipt(null, "req-1"));
  const second = sign(
    buildReceipt(signedDecisionReceiptHash(first), "req-2", { timestamp: "2026-07-07T12:00:01.000Z" })
  );
  return [first, second];
}

describe("receipt chain: malformed input is rejected", () => {
  it("rejects a non-array chain", () => {
    // Kills the line-11 guard. `verifyDecisionReceiptChain` is typed
    // `unknown[]`, but it is called on parsed JSON at trust boundaries where the
    // type says nothing about what actually arrived.
    const checks = verifyDecisionReceiptChain("not-an-array" as unknown as unknown[]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.passed).toBe(false);
    expect(checks[0]?.index).toBe(-1);
    expect(checks[0]?.detail).toMatch(/must be an array/u);
  });

  it("rejects an empty chain rather than vacuously passing it", () => {
    // Kills the line-14 guard. An empty chain returning [] would mean "no failed
    // checks", which every caller that tests `checks.every(c => c.passed)` reads
    // as success. Vacuous truth is the failure mode here.
    const checks = verifyDecisionReceiptChain([]);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.passed).toBe(false);
    expect(checks[0]?.detail).toMatch(/at least one receipt/u);
  });

  it("reports schema validation failure per receipt", () => {
    const checks = verifyDecisionReceiptChain([{ not: "a receipt" }]);
    expect(checks[0]?.passed).toBe(false);
    expect(checks[0]?.detail).toMatch(/schema validation failed/u);
  });
});

describe("receipt chain: continuity breaks are detected", () => {
  it("accepts the untampered control chain", () => {
    // The control arm. Without it every assertion below is satisfied by a
    // verifier that rejects everything.
    const checks = verifyDecisionReceiptChain(validChain());
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("detects a hash-chain break and names both hashes", () => {
    const [first] = validChain();
    const forged = sign(
      buildReceipt(`sha256:${"f".repeat(64)}`, "req-2", { timestamp: "2026-07-07T12:00:01.000Z" })
    );
    const checks = verifyDecisionReceiptChain([first, forged]);

    expect(checks[0]?.passed).toBe(true);
    expect(checks[1]?.passed).toBe(false);
    expect(checks[1]?.detail).toMatch(/Hash-chain break/u);
    // Kills the line-76 LogicalOperator mutant: the observed hash must be
    // reported, not silently rendered as "null".
    expect(checks[1]?.detail).toContain(`sha256:${"f".repeat(64)}`);
  });

  it("detects a duplicate signed receipt hash", () => {
    // The replay case: the same signed receipt submitted twice. Its mutants had
    // NO coverage, so a chain verifier that accepted replays would have passed
    // the entire suite.
    const first = sign(buildReceipt(null, "req-1"));
    const checks = verifyDecisionReceiptChain([first, first]);

    expect(checks[0]?.passed).toBe(true);
    expect(checks[1]?.passed).toBe(false);
    expect(checks[1]?.detail).toMatch(/Duplicate signed receipt hash/u);
  });

  it("detects a first receipt that wrongly declares a predecessor", () => {
    // A chain whose head claims a parent is a chain with an unverifiable prefix:
    // the receipt before it is unaccounted for.
    const orphan = sign(buildReceipt(`sha256:${"a".repeat(64)}`, "req-1"));
    const checks = verifyDecisionReceiptChain([orphan]);

    expect(checks[0]?.passed).toBe(false);
    expect(checks[0]?.detail).toMatch(/unexpectedly declares a previous receipt hash/u);
  });

  it("detects a timestamp that moves backwards", () => {
    const first = sign(buildReceipt(null, "req-1", { timestamp: "2026-07-07T12:00:05.000Z" }));
    const backdated = sign(
      buildReceipt(signedDecisionReceiptHash(first), "req-2", { timestamp: "2026-07-07T12:00:01.000Z" })
    );
    const checks = verifyDecisionReceiptChain([first, backdated]);

    expect(checks[1]?.passed).toBe(false);
    expect(checks[1]?.detail).toMatch(/earlier than prior receipt timestamp/u);
  });

  it("accepts equal timestamps, since the rule is monotonic, not strictly increasing", () => {
    // The boundary. Without this, a mutant turning `<` into `<=` would survive,
    // and two receipts emitted inside the same millisecond would be rejected as
    // a tamper — a false positive on ordinary traffic.
    const stamp = "2026-07-07T12:00:00.000Z";
    const first = sign(buildReceipt(null, "req-1", { timestamp: stamp }));
    const second = sign(
      buildReceipt(signedDecisionReceiptHash(first), "req-2", { timestamp: stamp })
    );
    const checks = verifyDecisionReceiptChain([first, second]);

    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("cannot verify continuity past an invalid prior receipt", () => {
    const first = sign(buildReceipt(null, "req-1"));
    const second = sign(
      buildReceipt(signedDecisionReceiptHash(first), "req-2", { timestamp: "2026-07-07T12:00:01.000Z" })
    );
    const checks = verifyDecisionReceiptChain([{ not: "a receipt" }, second]);

    expect(checks[0]?.passed).toBe(false);
    expect(checks[1]?.passed).toBe(false);
    expect(checks[1]?.detail).toMatch(/prior receipt is invalid/u);
  });

  it("detects a tenant-chain break", () => {
    const first = sign(buildReceipt(null, "req-1"));
    const otherTenant = sign(
      buildReceipt(signedDecisionReceiptHash(first), "req-2", {
        tenantId: "tenant-b",
        timestamp: "2026-07-07T12:00:01.000Z"
      })
    );
    const checks = verifyDecisionReceiptChain([first, otherTenant]);

    expect(checks[1]?.passed).toBe(false);
    expect(checks[1]?.detail).toMatch(/Tenant-chain break/u);
  });
});
