import { describe, expect, it } from "vitest";
import { DECLARED_GENERATOR, MUTATION_OPERATORS, runE1BRandomized } from "../../../tools/experiments/e1bRandomizedKernel";
import { runE5Agreement } from "../../../tools/experiments/e5VerifierAgreement";
import { MIN_N_FOR_PROPORTION_INTERVAL } from "../../../packages/research-frontier/src/stats/descriptive";

/** Small trial count for test speed; the reported figures come from the CLI default. */
const TEST_TRIALS = 120;

describe("E1-B randomized kernel probe", () => {
  it("is exactly reproducible from its seed", async () => {
    // A result that cannot be replayed is not evidence. Math.random() is deliberately unused.
    const first = runE1BRandomized({ seed: 4242, trialsPerOperator: TEST_TRIALS });
    const second = runE1BRandomized({ seed: 4242, trialsPerOperator: TEST_TRIALS });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("actually depends on the seed", async () => {
    // Guards the opposite failure: a harness that ignores its seed and looks deterministic.
    const a = runE1BRandomized({ seed: 1, trialsPerOperator: TEST_TRIALS });
    const b = runE1BRandomized({ seed: 2, trialsPerOperator: TEST_TRIALS });
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
  });

  it("is declared SAMPLED, which is what makes its confidence intervals legitimate", () => {
    const report = runE1BRandomized({ trialsPerOperator: TEST_TRIALS });
    expect(report.sample_provenance).toBe("sampled");

    // This is the ONLY experiment in the repository that may carry an interval. E1/E3/E5 are
    // censuses and their intervals are suppressed by construction.
    const withIntervals = report.results.filter((result) => result.unsoundRate.interval !== null);
    expect(withIntervals.length).toBeGreaterThan(0);
  });

  it("suppresses intervals for any operator that did not reach the minimum n", () => {
    const report = runE1BRandomized({ trialsPerOperator: 5 });
    for (const result of report.results) {
      const applicable = result.decided + result.rejected;
      if (applicable < MIN_N_FOR_PROPORTION_INTERVAL) {
        expect(result.unsoundRate.interval, `${result.operatorId}/${result.armId} carried an interval at n=${applicable}`).toBeNull();
        expect(result.unsoundRate.intervalOmittedBecause).toBeTruthy();
      }
    }
  });

  it("quantifies the unguarded unintended-kernel rate with a real interval", () => {
    const report = runE1BRandomized({ trialsPerOperator: 300 });
    const unguarded = report.unintendedKernelRate.find((entry) => entry.armId === "ghost-ark-receipt-schema");

    expect(unguarded?.report.interval).not.toBeNull();
    // The measured rate is substantial under this generator, and the interval excludes zero.
    expect(unguarded?.report.observed).toBeGreaterThan(0.2);
    expect(unguarded?.report.interval?.low).toBeGreaterThan(0.1);
  });

  it("shows strict admission drives the rate to zero over the SAME denominator", () => {
    const report = runE1BRandomized({ trialsPerOperator: 300 });
    const unguarded = report.unintendedKernelRate.find((entry) => entry.armId === "ghost-ark-receipt-schema");
    const guarded = report.unintendedKernelRate.find((entry) => entry.armId === "ghost-ark-strict-admission");

    // The fairness property. Scoring only `decided` trials would let the guarded arm look
    // good by rejecting the hard cases and being graded on what remained; both arms must
    // face the same denominator, with rejection counted as a sound outcome.
    expect(guarded?.report.total).toBe(unguarded?.report.total);
    expect(guarded?.report.successes).toBe(0);
    // And the intervals must be disjoint, or the effect is not established.
    expect(guarded?.report.interval?.high).toBeLessThan(unguarded?.report.interval?.low ?? 0);
  });

  it("declares its generator, so the sampling claim is inspectable", () => {
    const report = runE1BRandomized({ trialsPerOperator: TEST_TRIALS });
    expect(report.generator).toEqual(DECLARED_GENERATOR);
    expect(report.non_claim).toMatch(/not under production receipt traffic/u);
  });

  it("gives every operator a declared class and a rationale", () => {
    for (const operator of MUTATION_OPERATORS) {
      expect(["preserving", "changing"]).toContain(operator.operatorClass);
      expect(operator.rationale.length, `${operator.id} has no rationale`).toBeGreaterThan(30);
    }
  });

  it("keeps preserving operators from being scored as unintended kernel members", () => {
    const report = runE1BRandomized({ trialsPerOperator: 200 });
    const preserving = report.results.filter((result) => result.operatorClass === "preserving" && result.armId === "ghost-ark-receipt-schema");

    // A preserving operator SHOULD collapse: objects are unordered, whitespace is
    // insignificant, escapes decode identically. A low rate here would mean
    // over-discrimination, not a kernel defect.
    for (const result of preserving) {
      if (result.decided >= MIN_N_FOR_PROPORTION_INTERVAL) {
        expect(result.collapseRate.observed, `${result.operatorId} should collapse`).toBeGreaterThan(0.9);
      }
    }
  });

  it("counts inapplicable draws separately instead of retrying them into the denominator", () => {
    const report = runE1BRandomized({ trialsPerOperator: TEST_TRIALS });
    for (const result of report.results) {
      expect(result.decided + result.rejected + result.inapplicable).toBe(TEST_TRIALS);
    }
  });
});

describe("E5 cross-language verifier agreement", () => {
  it("finds zero disagreements between the two full verifiers", async () => {
    const report = runE5Agreement();
    expect(report.disagreements).toEqual([]);
  }, 180_000);

  it("compares only genuine peers, not a deliberately weaker check", async () => {
    const report = runE5Agreement();
    // The identity-only arm must never be held to peer agreement. An earlier version of this
    // experiment did that and manufactured 12 false disagreements out of the weaker check
    // correctly declining to detect signature tampering it never inspects.
    expect(report.peerVerifiers).not.toContain("ts-receipt-identity");
    expect(report.subsumedVerifiers).toContain("ts-receipt-identity");
  }, 180_000);

  it("holds the identity check to subsumption: identity failure implies verification failure", async () => {
    const report = runE5Agreement();
    // The converse is not required — a full verifier also checks signatures the identity
    // check never sees — but a receipt whose identity does not recompute must never be
    // accepted by a verifier that also recomputes identity.
    expect(report.subsumptionViolations).toEqual([]);
  }, 180_000);

  it("reports the accept arm, without which rejecting everything would score 100%", async () => {
    const report = runE5Agreement();
    expect(report.agreementOnAccepts.total).toBeGreaterThan(0);
    expect(report.agreementOnAccepts.successes).toBe(report.agreementOnAccepts.total);
    expect(report.agreementOnRejects.successes).toBe(report.agreementOnRejects.total);
  }, 180_000);

  it("treats an unavailable verifier as unavailable rather than as agreeing", async () => {
    const report = runE5Agreement();
    // A silently-absent verifier would inflate agreement to 100% by having nothing to
    // disagree with. Availability is probed and reported per verifier.
    for (const probe of report.probes) {
      expect(typeof probe.available).toBe("boolean");
      expect(probe.detail.length).toBeGreaterThan(0);
      if (!probe.available) {
        expect(report.availableVerifiers).not.toContain(probe.id);
      }
    }
    expect(report.availableVerifiers.length).toBeGreaterThan(1);
  }, 180_000);

  it("never attaches an interval: the corpus is a census", async () => {
    const report = runE5Agreement();
    expect(report.sample_provenance).toBe("census");
    expect(report.agreementOnRejects.interval).toBeNull();
    expect(report.agreementOnAccepts.interval).toBeNull();
  }, 180_000);
});
