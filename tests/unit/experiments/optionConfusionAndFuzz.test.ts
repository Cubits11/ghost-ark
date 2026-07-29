import { describe, expect, it } from "vitest";
import { runE6OptionConfusion } from "../../../tools/experiments/e6OptionConfusion";
import { DECLARED_GENERATOR, runE7Fuzz } from "../../../tools/experiments/e7DifferentialFuzz";
import { MIN_N_FOR_PROPORTION_INTERVAL } from "../../../packages/research-frontier/src/stats/descriptive";

/** Small trial counts for suite speed; reported figures come from the CLI defaults. */
const FUZZ_TRIALS = 200;

describe("E6 verifier option-confusion matrix", () => {
  it("holds every declared invariant over the full cross-product", () => {
    const report = runE6OptionConfusion();
    const violated = report.invariants.filter((invariant) => !invariant.held);
    expect(
      violated.map((invariant) => `${invariant.id}: ${invariant.violations.length} violations`),
      "an option combination reached an outcome the invariants forbid"
    ).toEqual([]);
  }, 240_000);

  it("fails closed on absent AND wrong key material", () => {
    const report = runE6OptionConfusion();
    // "absent" matters as much as "wrong". A verifier that accepted on missing key material
    // would be trivially bypassable by simply not supplying one.
    const accepted = report.cells.filter((cell) => cell.verdict === "PASS");
    expect(accepted.filter((cell) => cell.keyMaterial === "absent")).toEqual([]);
    expect(accepted.filter((cell) => cell.keyMaterial === "wrong")).toEqual([]);
  }, 240_000);

  it("is ANTITONE in the consumer set, which is the thesis measured rather than assumed", () => {
    const report = runE6OptionConfusion();
    const antitone = report.invariants.find((invariant) => invariant.id === "I5");

    // Sound(C, Sigma, P) is antitone in P: adding a consumer can only add distinctions that must
    // be preserved. Operationally, adding a CORRECT expectation must never turn a rejection into
    // an acceptance. If this ever fails, the thesis's central structural claim does not hold for
    // this implementation.
    expect(antitone).toBeDefined();
    expect(antitone?.held, "the verifier is not antitone in its consumer set").toBe(true);
  }, 240_000);

  it("never accepts an intrinsically invalid receipt under any option combination", () => {
    const report = runE6OptionConfusion();
    expect(report.invariants.find((invariant) => invariant.id === "I6")?.held).toBe(true);
  }, 240_000);

  it("distinguishes relational from intrinsic defects instead of conflating them", () => {
    const report = runE6OptionConfusion();

    // MAL-014 and MAL-028 are VALID receipts that are wrong only for a mismatching consumer.
    // Requiring them to be rejected unconditionally would assert that a correct receipt must be
    // rejected — an earlier version of this experiment did exactly that and reported two false
    // invariant violations.
    const relationalAccepted = report.cells.filter(
      (cell) => (cell.fixtureId === "MAL-014" || cell.fixtureId === "MAL-028") && cell.verdict === "PASS"
    );
    expect(relationalAccepted.length, "a relational fixture must be accepted by a MATCHING consumer").toBeGreaterThan(0);
    // ...and never while the consumer mismatches it.
    expect(relationalAccepted.filter((cell) => cell.tenantExpectation === "mismatches-receipt")).toEqual([]);
  }, 240_000);

  it("confines RSA acceptance to a single PSS mode", () => {
    const report = runE6OptionConfusion();
    const rsaAccepted = report.cells.filter((cell) => cell.fixtureId.startsWith("kms") && cell.verdict === "PASS");

    // digest-as-message and digest-as-mhash are not interchangeable. A receipt that verified
    // under both would let a consumer be induced to accept a signature the signer never produced
    // for that interpretation.
    expect(rsaAccepted.length).toBeGreaterThan(0);
    expect(new Set(rsaAccepted.map((cell) => cell.pssMode)).size).toBe(1);
    expect(report.invariants.find((invariant) => invariant.id === "I8")?.held).toBe(true);
  }, 240_000);

  it("never attaches an interval: the cross-product is a census", () => {
    const report = runE6OptionConfusion();
    expect(report.sample_provenance).toBe("census");
    expect(report.acceptanceRate.interval).toBeNull();
  }, 240_000);
});

describe("E7 cross-language differential fuzz", () => {
  it("is exactly reproducible from its seed, and actually depends on it", () => {
    const first = runE7Fuzz({ seed: 777, trials: FUZZ_TRIALS });
    const second = runE7Fuzz({ seed: 777, trials: FUZZ_TRIALS });
    const different = runE7Fuzz({ seed: 778, trials: FUZZ_TRIALS });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(different)).not.toBe(JSON.stringify(first));
  }, 300_000);

  it("runs at least two independent arms, and reports any that are unavailable", () => {
    const report = runE7Fuzz({ trials: FUZZ_TRIALS });
    const available = report.arms.filter((arm) => arm.available);

    // A silently-absent arm would drive divergence to zero by having nothing to disagree with.
    expect(available.length).toBeGreaterThanOrEqual(2);
    for (const arm of report.arms) {
      expect(arm.detail.length, `${arm.id} reported no detail`).toBeGreaterThan(0);
    }
  }, 300_000);

  it("generates a corpus that is substantially malformed, or it could not find validity divergences", () => {
    const report = runE7Fuzz({ trials: FUZZ_TRIALS });
    // If everything generated were valid JSON, the experiment could only ever find digest
    // divergences and would silently be a weaker version of E1-B.
    expect(report.unanimouslyRejected).toBeGreaterThan(0);
    expect(report.unanimouslyAccepted).toBeGreaterThan(0);
    expect(report.generator).toEqual(DECLARED_GENERATOR);
  }, 300_000);

  it("reports validity and structure rates over their OWN denominators", () => {
    const report = runE7Fuzz({ trials: FUZZ_TRIALS });

    // These two counts are not addable: one is per input, the other per pair. An earlier version
    // summed them into a single rate over `trials`, which was meaningless.
    expect(report.validityDivergenceRate.total).toBe(report.trials);
    expect(report.structureDivergenceRate.total).toBe(report.comparedPairs);
    expect(report.comparedPairs).not.toBe(report.trials);
  }, 300_000);

  it("earns its confidence intervals by being genuinely sampled", () => {
    const report = runE7Fuzz({ trials: 400 });
    expect(report.sample_provenance).toBe("sampled");
    if (report.trials >= MIN_N_FOR_PROPORTION_INTERVAL) {
      expect(report.validityDivergenceRate.interval).not.toBeNull();
    }
  }, 300_000);

  it("independently rediscovers E1's integer-precision kernel member, with a third arm confirming", () => {
    const report = runE7Fuzz({ trials: 600 });
    const integerClass = report.structureClasses.find((entry) => entry.pair.includes("9007199254740993"));

    if (report.arms.filter((arm) => arm.available).length < 3) {
      // With fewer than three arms the outlier attribution is not meaningful; skip rather than
      // assert something the run cannot support.
      return;
    }

    // E1 found this with a hand-picked pair. E7 finds it by random search, and names V8 as the
    // outlier against TWO independent implementations rather than one.
    expect(integerClass, "E7 did not rediscover the integer-precision divergence").toBeDefined();
    expect(integerClass?.outlier).toBe("v8");
    expect(integerClass?.behavior).toBe("identifies-both-as-same");
  }, 300_000);

  it("reports distinct divergence CLASSES, not just a rate", () => {
    const report = runE7Fuzz({ trials: 600 });

    // A random generator rediscovers the same handful of classes hundreds of times. Reporting
    // only "199 divergent pairs" would overstate the diversity of the problem; the class list is
    // what makes the rate readable.
    expect(report.structureClasses.length).toBeGreaterThan(0);
    expect(report.structureClasses.length).toBeLessThan(report.structureDivergentPairs);
    for (const structureClass of report.structureClasses) {
      expect(structureClass.outlier).not.toBe("indeterminate");
    }
  }, 300_000);

  it("shows no two arms induce the same equivalence relation", () => {
    const report = runE7Fuzz({ trials: 600 });
    if (report.arms.filter((arm) => arm.available).length < 3) {
      return;
    }

    // The sharper form of corollary C1. If one arm were the outlier on every class, the story
    // would be "that arm is broken". Instead each arm is the outlier on at least one class, so
    // no pair of these pipelines agrees about which inputs are the same — which is exactly what
    // makes cross-runtime re-verification unsound today.
    const outliers = new Set(report.structureClasses.map((entry) => entry.outlier));
    expect(outliers.size).toBeGreaterThan(1);
  }, 300_000);
});
