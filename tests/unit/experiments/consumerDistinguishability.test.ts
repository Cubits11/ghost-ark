import { describe, expect, it } from "vitest";

import {
  buildConsumerModels,
  runE16,
  toPlainDecimalLiteral,
  type ConsumerModel,
  type Decision,
  type E16PairSpec
} from "../../../tools/experiments/e16ConsumerDistinguishability";

/**
 * Guard tests for E16 — consumer distinguishability.
 *
 * E16 is the experiment that converts the thesis from structural to consequential:
 * it shows, by execution, that a real deployed consumer reaches two different
 * DECISIONS on two documents the Ghost-Ark receipt canonicalizer maps to ONE
 * identity. These tests pin the measured findings AND — following the E4
 * discriminator principle applied to E16 itself — prove the harness can report
 * agreement and can fail. A harness that always reports a flip proves nothing.
 *
 * Two halves:
 *  1. Measured findings against the REAL engines (opa/cue/jq/python). Skipped on a
 *     machine missing one, like E11; GHOST_ARK_REQUIRE_E16=1 turns a missing engine
 *     into a failure in the job that is supposed to run it.
 *  2. Harness LOGIC against injected in-process consumers — no subprocess spawning —
 *     so the refusal, monotonicity, and discriminator-can-fail branches are exercised
 *     in milliseconds and on every machine.
 */

// ---------------------------------------------------------------------------
// Part 1 — measured findings against the real, deployed engines.
// ---------------------------------------------------------------------------

const models = buildConsumerModels();
const allAvailable = models.every((m) => m.available);
const requireAll = process.env.GHOST_ARK_REQUIRE_E16 === "1";

if (requireAll && !allAvailable) {
  const missing = models.filter((m) => !m.available).map((m) => `${m.id} (${m.versionDetail})`);
  throw new Error(
    `ghost_ark.e16: GHOST_ARK_REQUIRE_E16=1 but ${missing.length} consumer(s) are unavailable: ${missing.join("; ")}. ` +
      "This is the job that runs E16 for real; skipping here would report green while measuring nothing."
  );
}

const describeIfAvailable = allAvailable ? describe : describe.skip;
const report = allAvailable ? runE16({ host: "test-host" }) : (null as unknown as ReturnType<typeof runE16>);

function cell(pathologyId: string, consumerId: string) {
  const found = report.cells.find((c) => c.pathologyId === pathologyId && c.consumerId === consumerId);
  if (!found) {
    throw new Error(`ghost_ark.e16 test: no cell for ${pathologyId} / ${consumerId}`);
  }
  return found;
}

describeIfAvailable("E16 measured findings (real deployed consumers)", () => {
  it("exercises all four named, version-pinned engines", () => {
    expect(report.consumers.map((c) => c.consumerId).sort()).toEqual(["cpython", "cue", "jq", "opa-rego"]);
    expect(report.degraded).toBe(false);
    // A finding with no pinned version is not a finding.
    for (const c of report.consumers) {
      expect(c.versionDetail, `${c.consumerId} must report a version`).toMatch(/\d/u);
    }
  });

  it("reports a census, so no confidence intervals are attached", () => {
    expect(report.sample_provenance).toBe("census");
  });

  it("confirms the PREMISE in-process: every pair collapses to one receipt identity", () => {
    // The whole experiment is meaningless if the receipt does NOT actually identify
    // the two documents. This is measured against the real canonicalizer, not asserted.
    for (const c of report.cells) {
      expect(c.ghostArkCollapses, `${c.pathologyId} must collapse under Ghost-Ark`).toBe(true);
    }
    for (const p of report.pairs) {
      expect(p.sharedReceiptDigest, `${p.pathologyId} shared digest`).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("HEADLINE: OPA/Rego reaches allow on one document and deny on a byte-distinct one the receipt collapses", () => {
    // decimal-literal-collapse: {"rate":0.1} vs {"rate":0.1000...0555}. One receipt
    // identity; OPA allows the first and denies the second. This single cell closes
    // the open gap "no consumer has been named and shown to distinguish any pair".
    const dec = cell("decimal-literal-collapse", "opa-rego");
    expect(dec.decisionA).toBe<Decision>("accept");
    expect(dec.decisionB).toBe<Decision>("deny");
    expect(dec.distinguishes).toBe(true);
    expect(dec.consequentialSplit).toBe(true);
  });

  it("finds decimal-literal split by OPA, CUE, and jq — three independent engines", () => {
    for (const consumer of ["opa-rego", "cue", "jq"]) {
      expect(cell("decimal-literal-collapse", consumer).distinguishes, `${consumer} on decimal-literal`).toBe(true);
    }
  });

  it("NEGATIVE CONTROL: CPython does NOT split decimal-literal — it collapses it too (IEEE-754 double)", () => {
    // A consumer that AGREES with the canonicalizer on a finding pair. This is the
    // in-band proof that the flips are a property of each engine's number model, not
    // a harness that always reports a difference.
    const dec = cell("decimal-literal-collapse", "cpython");
    expect(dec.decisionA).toBe<Decision>("accept");
    expect(dec.decisionB).toBe<Decision>("accept");
    expect(dec.distinguishes).toBe(false);
  });

  it("finds integer-precision split by every engine (2^53 neighbours)", () => {
    for (const consumer of ["opa-rego", "cue", "jq", "cpython"]) {
      expect(cell("integer-precision-loss", consumer).distinguishes, `${consumer} on integer-precision`).toBe(true);
    }
  });

  it("records that the duplicate-key collapse is INERT for last-wins consumers but FATAL for CUE", () => {
    // OPA, jq, CPython all resolve last-wins, so {"amount":1,"amount":2} and
    // {"amount":2} are the same to them — the universal collapse is inert. CUE treats
    // the repeated field as a unification conflict, so it distinguishes. Both halves
    // are the finding, and neither is allowed to quietly disappear.
    expect(cell("duplicate-key-last-wins", "opa-rego").distinguishes).toBe(false);
    expect(cell("duplicate-key-last-wins", "jq").distinguishes).toBe(false);
    expect(cell("duplicate-key-last-wins", "cpython").distinguishes).toBe(false);
    expect(cell("duplicate-key-last-wins", "cue").distinguishes).toBe(true);
  });

  it("DISCRIMINATOR: every engine AGREES on trailing-zero (1.50 vs 1.5), so the harness measures decisions not bytes", () => {
    expect(report.discriminator_holds).toBe(true);
    for (const consumer of ["opa-rego", "cue", "jq", "cpython"]) {
      const disc = cell("trailing-zero-fraction", consumer);
      expect(disc.distinguishes, `${consumer} must agree on trailing-zero`).toBe(false);
      expect(disc.decisionA, `${consumer} must accept both sides`).toBe<Decision>("accept");
    }
  });

  it("records CUE over-discrimination on equivalent-intent pairs (int != float), reported as the antitone dual", () => {
    // CUE distinguishes {"v":1.0} from {"v":1} and {"v":1e2} from {"v":100}, which
    // Ghost-Ark declares EQUIVALENT. This is not an unintended kernel member; it is a
    // consumer whose model is finer than the declared equivalence. Reported honestly
    // and separately so it is not conflated with the distinct-intent findings.
    expect(cell("float-vs-integer-same-value", "cue").distinguishes).toBe(true);
    expect(cell("numeric-exponent-form", "cue").distinguishes).toBe(true);
    expect(cell("float-vs-integer-same-value", "opa-rego").distinguishes).toBe(false);
    expect(report.over_discriminations.some((o) => o.consumerId === "cue")).toBe(true);
  });

  it("closes the gap: at least one deployed, named consumer distinguishes a pair the canonicalizer collapses", () => {
    expect(report.distinguishing_consumers.length).toBeGreaterThan(0);
    expect(report.consequential_splits.length).toBeGreaterThan(0);
    expect(report.distinguishing_consumers).toContain("opa-rego");
  });

  it("carries a non-claim that scopes the result to POSSIBLE, not prevalent, and cites E12's 0/64", () => {
    expect(report.non_claim).toMatch(/POSSIBLE/u);
    expect(report.non_claim).toMatch(/0 of 64/u);
    expect(report.non_claim).toMatch(/not a security review/u);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — harness logic against injected consumers (no subprocess spawning).
// ---------------------------------------------------------------------------

/** A consumer that agrees with the canonicalizer everywhere: never distinguishes. */
function neverDistinguish(id: string, available = true): ConsumerModel {
  return {
    id,
    name: id,
    deployment: "test double",
    decisionKind: "test",
    available,
    versionDetail: available ? "vtest" : "missing",
    commandTemplate: "n/a",
    independentOfRepo: true,
    decide: () => ({ decision: "accept", raw: "accept" })
  };
}

/**
 * A consumer that decides on WIRE BYTES (here: raw length parity) rather than the
 * parsed value — exactly the artifact the discriminator exists to catch. It flips on
 * trailing-zero ({"v":1.50} is 10 bytes, {"v":1.5} is 9), so a run containing it must
 * report discriminator_holds === false.
 */
function rawByteSensitive(id: string): ConsumerModel {
  return {
    ...neverDistinguish(id),
    decide: (rawJson) => ({ decision: rawJson.length % 2 === 0 ? "accept" : "deny", raw: String(rawJson.length) })
  };
}

/**
 * A consumer that compares the field's EXACT decimal text to the injected literal —
 * a faithful stand-in for an arbitrary-precision engine. Distinguishes decimal-literal
 * without spawning anything.
 */
function exactTextDistinguisher(id: string, available = true): ConsumerModel {
  return {
    ...neverDistinguish(id, available),
    decide: (rawJson, field, literal) => {
      const match = new RegExp(`"${field}"\\s*:\\s*(-?[0-9.eE+]+)`, "u").exec(rawJson);
      const token = match?.[1] ?? "";
      return { decision: token === literal ? "accept" : "deny", raw: token };
    }
  };
}

const DECIMAL: E16PairSpec = { pathologyId: "decimal-literal-collapse", role: "finding" };
const DISCRIMINATOR: E16PairSpec = { pathologyId: "trailing-zero-fraction", role: "discriminator" };

describe("E16 harness logic (injected consumers)", () => {
  it("refuses to emit a NULL result while a declared consumer is missing", () => {
    // "No consumer distinguishes" cannot be concluded with an engine absent — that is
    // rule 4 (refuse, do not degrade). The refusal must argue WHY, so a maintainer does
    // not just pass the flag.
    const consumers = [neverDistinguish("present"), neverDistinguish("absent", false)];
    expect(() => runE16({ consumers, pairs: [DECIMAL] })).toThrow(/no consumer distinguished any pair/u);
    expect(() => runE16({ consumers, pairs: [DECIMAL] })).toThrow(/Refusing to emit a NULL result/u);
  });

  it("permits an explicitly-degraded NULL run and stamps it", () => {
    const consumers = [neverDistinguish("present"), neverDistinguish("absent", false)];
    const degraded = runE16({ consumers, pairs: [DECIMAL], allowDegradedConsumers: true });
    expect(degraded.degraded).toBe(true);
    expect(degraded.distinguishing_consumers).toEqual([]);
    expect(degraded.excluded_consumers.map((e) => e.consumerId)).toEqual(["absent"]);
  });

  it("does NOT refuse a POSITIVE result when a consumer is missing — existence is monotone", () => {
    // The asymmetry that mirrors E11's universal-vs-existence logic: finding a
    // distinguisher stands even if another engine is absent, because adding engines can
    // only add distinctions. Still flagged degraded.
    const consumers = [exactTextDistinguisher("precise"), neverDistinguish("absent", false)];
    const positive = runE16({ consumers, pairs: [DECIMAL] });
    expect(positive.distinguishing_consumers).toEqual(["precise"]);
    expect(positive.degraded).toBe(true);
  });

  it("DISCRIMINATOR CAN FAIL: a wire-byte consumer flips the equivalent pair and voids the run", () => {
    // Proves the discriminator is load-bearing. If discriminator_holds could not be
    // false, it would certify nothing.
    const voided = runE16({ consumers: [rawByteSensitive("bytes")], pairs: [DISCRIMINATOR], allowDegradedConsumers: true });
    expect(voided.discriminator_holds).toBe(false);
  });

  it("DISCRIMINATOR CAN HOLD: a value-based consumer agrees on the equivalent pair", () => {
    const held = runE16({ consumers: [neverDistinguish("value")], pairs: [DISCRIMINATOR] });
    expect(held.discriminator_holds).toBe(true);
  });

  it("refuses a pair the Ghost-Ark canonicalizer does NOT collapse (premise guard)", () => {
    // safe-integer-neighbours are two DIFFERENT safe integers; the receipt distinguishes
    // them, so they cannot be an E16 pair. The harness must reject the premise rather
    // than measure a meaningless flip.
    const neighbours: E16PairSpec = { pathologyId: "safe-integer-neighbours", role: "finding" };
    expect(() => runE16({ consumers: [neverDistinguish("x")], pairs: [neighbours] })).toThrow(/NOT collapsed/u);
  });

  it("refuses to inject an engine-ambiguous numeric constant", () => {
    expect(() => toPlainDecimalLiteral(1e21)).toThrow(/plain decimal literal/u);
    expect(() => toPlainDecimalLiteral(Number.NaN)).toThrow(/non-finite/u);
    expect(toPlainDecimalLiteral(0.1)).toBe("0.1");
    expect(toPlainDecimalLiteral(9007199254740992)).toBe("9007199254740992");
  });
});
