import { describe, expect, it } from "vitest";
import { CHECK_NAMES, runE4Guard } from "../../../tools/experiments/e4MetamorphicGuard";
import { runE3Detection } from "../../../tools/experiments/e3CorpusDetection";

describe("E3 corpus detection (measured against the real verifier)", () => {
  it("rejects every DETECTABLE corpus mutation somewhere in the pipeline", async () => {
    const report = await runE3Detection();
    expect(report.detection.successes).toBe(report.detection.total);
    // "undetected" now means undetected AND not declared acceptable. The compromised-signer
    // boundary fixtures (MAL-029, MAL-030) live in their own stratum and are excluded from the
    // detection denominator, so this invariant stays meaningful rather than becoming permanently
    // nonzero.
    expect(report.strata.undetected).toBe(0);
    expect(report.strata["documented-boundary"]).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("keeps the control arm meaningful: unmutated fixtures must PASS", async () => {
    const report = await runE3Detection();
    // Without this, a verifier that failed everything would score a perfect
    // "detection rate" while being useless.
    expect(report.base_fixture_control.successes).toBe(report.base_fixture_control.total);
    expect(report.base_fixture_control.total).toBeGreaterThan(0);
  }, 120_000);

  it("never attaches a confidence interval to the curated corpus", async () => {
    const report = await runE3Detection();
    expect(report.sample_provenance).toBe("census");
    expect(report.detection.interval).toBeNull();
    expect(report.verifier_intrinsic_detection.interval).toBeNull();
    expect(report.detection.intervalOmittedBecause).toBeTruthy();
  }, 120_000);

  it("separates verifier-intrinsic rejection from consumer-expectation rejection", async () => {
    const report = await runE3Detection();

    // MAL-014 is a byte-identical, cryptographically valid receipt presented to the
    // wrong tenant. No verifier rule can reject it; only the consumer's declared
    // expectation can. Folding it into the intrinsic rate would overstate the verifier.
    const crossTenant = report.outcomes.find((outcome) => outcome.attack_id === "MAL-014");
    expect(crossTenant?.verdict).toBe("PASS");
    expect(crossTenant?.stratum).toBe("consumer-expectation");
    expect(crossTenant?.declaredConsumerBoundary).toBe(true);
    expect(report.verifier_intrinsic_detection.total).toBeLessThan(report.detection.total);
  }, 120_000);

  it("records which specific check caught each mutation, not merely that one did", async () => {
    const report = await runE3Detection();
    const intrinsic = report.outcomes.filter((outcome) => outcome.stratum === "verifier-intrinsic");
    expect(intrinsic.length).toBeGreaterThan(20);
    for (const outcome of intrinsic) {
      expect(outcome.failedChecks.length, `${outcome.attack_id} rejected without naming a failed check`).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe("E4 metamorphic guard (are detections load-bearing?)", () => {
  it("confirms no corpus detection is tautological under the real verifier", async () => {
    const report = await runE4Guard();
    // The discriminator: with every check forced to pass, only rejections that do not
    // come from check logic may survive, and each must be a parse failure.
    expect(report.tautology_verdict).toMatch(/^PASS/u);
    expect(report.survivesAllChecksMutant.length).toBeLessThanOrEqual(1);
  }, 180_000);

  it("proves specific checks are load-bearing by naming the fixtures that depend on them", async () => {
    const report = await runE4Guard();
    expect(report.loadBearingChecks).toContain("signature");
    expect(report.loadBearingChecks).toContain("digest");
    expect(report.loadBearingChecks).toContain("schema");
    expect(report.loadBearingChecks).toContain("key_id");
    expect(report.loadBearingChecks).toContain("envelope");
  }, 180_000);

  it("mutating a single check never invalidates a valid receipt (control arm intact)", async () => {
    const report = await runE4Guard();
    // Forcing a check to PASS cannot make a good receipt fail. If it did, the mutation
    // broke something unrelated and that mutant's row would be uninterpretable.
    for (const mutant of report.mutants) {
      expect(mutant.controlArmIntact, `control arm broken by mutant ${String(mutant.mutatedCheck)}`).toBe(true);
    }
  }, 180_000);

  it("reports checks with no dependent fixture as a corpus gap rather than hiding them", async () => {
    const report = await runE4Guard();
    // receipt_id WAS the documented case, and E4-B closed it: MAL-027 carries a valid signature
    // over a payload containing an inconsistent id, which isolates the check. See
    // tests/unit/experiments/compromisedSigner.test.ts.
    expect(report.loadBearingChecks).toContain("receipt_id");
    // `tenant` remains a genuine gap: it belongs to the record-receipt (rct_) path and the
    // corpus contains no record receipts.
    expect(report.noDependentFixtures).toContain("tenant");
    // Every check must be accounted for in exactly one bucket. `notFixtureIsolable` holds the
    // two that no receipt fixture can reach by construction, so a 10/10 isolation target is
    // unreachable in principle rather than merely unmet.
    expect(report.loadBearingChecks.length + report.noDependentFixtures.length + report.notFixtureIsolable.length).toBe(
      CHECK_NAMES.length
    );
  }, 180_000);

  it("refuses to run if the verifier's check factory no longer matches the mutation target", async () => {
    // A mutation harness that silently stops mutating would report "everything is
    // load-bearing" while testing nothing. E4 must fail loudly instead. This asserts the
    // guard exists by checking the anchor text is still present in the verifier source.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../../../verifiers/node/ghost_receipt_verify.mjs"), "utf8");
    expect(source).toContain("function check(name, passed, detail) {");
  });
});

describe("E4 self-test: the guard can actually detect a tautology", () => {
  it("flags a tautological detector, which is what disqualified dab/bench", async () => {
    /**
     * The guard is only trustworthy if it FAILS on a known-bad detector. This models the
     * exact shape found in dab/bench/attacks/concurrency.ts:
     *
     *     detected: requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce
     *
     * Two fixtures are constructed, then asserted to have the properties just assigned
     * to them. No system under test is invoked, so breaking the system changes nothing.
     */
    const tautologicalDetector = (systemIsBroken: boolean): boolean => {
      const requestA = { nonce: "same-nonce", payload: "PAYMENT_A" };
      const requestB = { nonce: "same-nonce", payload: "PAYMENT_B" };
      void systemIsBroken; // never consulted — that is the defect
      return requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce;
    };

    const genuineDetector = (systemIsBroken: boolean): boolean => {
      const ledger = new Set<string>();
      const admit = (nonce: string): boolean => (systemIsBroken ? true : !ledger.has(nonce) && (ledger.add(nonce), true));
      admit("same-nonce");
      return !admit("same-nonce");
    };

    // Both "detect" when the system is healthy.
    expect(tautologicalDetector(false)).toBe(true);
    expect(genuineDetector(false)).toBe(true);

    // Only the genuine one stops detecting when the mechanism is broken. This is the
    // discriminator E4 applies to the real verifier.
    expect(tautologicalDetector(true)).toBe(true);
    expect(genuineDetector(true)).toBe(false);
  });
});
