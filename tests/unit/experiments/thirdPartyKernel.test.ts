import { describe, expect, it } from "vitest";

import { buildThirdPartyArms, runE11 } from "../../../tools/experiments/e11ThirdPartyKernel";

/**
 * Guard tests for E11 — the third-party kernel census.
 *
 * E11 exists to answer one objection that E1 structurally cannot: every arm E1
 * measures is either Ghost-Ark code or a Ghost-Ark script driving CPython, so a
 * kernel member found there might be an artifact of this repository rather than a
 * property of JSON canonicalization. E11 runs the same pre-registered alphabet
 * against four pipelines written entirely outside this project.
 *
 * The result both SUPPORTS and NARROWS the thesis, and these tests pin both
 * halves so a later change cannot quietly keep only the flattering one.
 */

const arms = buildThirdPartyArms();
const allAvailable = arms.every((arm) => arm.available);

// Skipped rather than degraded when a runtime is missing: a three-arm run
// answers a different question than a four-arm run, and reporting it under the
// same name is the defect E1's arm-availability guard exists to prevent.
//
// The census is computed CONDITIONALLY, not inside the describe body, because
// `describe.skip` still executes its callback during collection — so a bare
// `runE11()` there throws on any machine missing a runtime, which is exactly
// what happened on CI: the guards job runs before jq and the Rust arm are
// installed, and the file failed to collect rather than skipping.
//
// A SKIPPED generality test reports green while measuring nothing, so skipping
// is allowed only where the runtimes genuinely may be absent (a contributor
// laptop without Ruby). In the CI job that installs all four, GHOST_ARK_REQUIRE_E11
// makes absence a failure instead — otherwise the one job that exists to run this
// experiment could stop running it and nothing would say so.
const requireAllArms = process.env.GHOST_ARK_REQUIRE_E11 === "1";

if (requireAllArms && !allAvailable) {
  const missing = arms.filter((arm) => !arm.available).map((arm) => `${arm.id} (${arm.detail})`);
  throw new Error(
    `ghost_ark.e11: GHOST_ARK_REQUIRE_E11=1 but ${missing.length} arm(s) are unavailable: ${missing.join("; ")}. ` +
      "This job is the one that runs E11 for real; skipping here would report green while measuring nothing."
  );
}

const describeIfAvailable = allAvailable ? describe : describe.skip;
const report = allAvailable ? runE11() : (null as unknown as ReturnType<typeof runE11>);

describeIfAvailable("E11 third-party kernel census", () => {

  it("runs four independent implementations across four language ecosystems", () => {
    expect(report.arms).toHaveLength(4);
    expect(report.degraded).toBe(false);
    expect(report.arms.map((arm) => arm.language).sort()).toEqual(["CPython", "Ruby", "Rust", "jq"]);
  });

  it("reports a census, so no confidence intervals are attached", () => {
    expect(report.sample_provenance).toBe("census");
  });

  it("finds unintended kernel members in EVERY third-party implementation", () => {
    // The load-bearing assertion for corollary C2. If any arm scored zero, the
    // claim that kernel members are a property of the problem rather than of
    // Ghost-Ark's implementation would be weakened at exactly that arm.
    for (const arm of report.arms) {
      expect(arm.unintendedKernel, `${arm.armId} should exhibit kernel members`).toBeGreaterThan(0);
    }
  });

  it("finds duplicate-key collapse universal across all four ecosystems", () => {
    // Rust, Ruby, CPython, and jq were written by four different groups, none of
    // whom saw this alphabet, and all four identify a document that asserted a
    // key twice with one that asserted it once. This is the strongest evidence
    // in the repository that the kernel is a property of JSON identity rather
    // than of Ghost-Ark.
    expect(report.universal_third_party_kernel).toContain("duplicate-key-last-wins");
    expect(report.universal_third_party_kernel).toContain("nested-duplicate-key-in-array");
    expect(report.universal_third_party_kernel).toContain("duplicate-empty-key");
  });

  it("finds NFC/NFD over-discrimination universal too", () => {
    // The dual defect is also not a Ghost-Ark artifact: all four split a name
    // every consumer treats as one string. Pinned because it is unflattering to
    // the idea that over-discrimination is a fixable implementation choice.
    const nfc = report.cells.filter((cell) => cell.pathologyId === "unicode-nfc-vs-nfd");
    expect(nfc).toHaveLength(4);
    for (const cell of nfc) {
      expect(cell.verdict, `${cell.armId} on NFC/NFD`).toBe("over-discrimination");
    }
  });

  it("does NOT find the 2^53 integer collapse outside the JavaScript number model", () => {
    // This narrows the thesis and must not be quietly dropped.
    //
    // E1 reports `integer-precision-loss` as a universal unintended kernel member
    // across its arms — but four of those five arms parse with V8, whose only
    // number type is a double. Rust serde_json, Ruby, CPython, and jq 1.7 all
    // preserve integer precision and score SOUND here.
    //
    // So the 2^53 collapse is a property of double-backed number models, not of
    // JSON. E1's finding is real and narrower than its arm mix suggests, and
    // saying so is the difference between a result and an overclaim.
    const cells = report.cells.filter((cell) => cell.pathologyId === "integer-precision-loss");
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.verdict, `${cell.armId} on 2^53`).toBe("sound");
    }
    expect(report.universal_third_party_kernel).not.toContain("integer-precision-loss");
  });

  it("shows the third-party arms disagreeing with EACH OTHER, not only with Ghost-Ark", () => {
    // E7 found no two of three pipelines induce the same equivalence relation.
    // E11 reproduces that at wider scope: these four disagree among themselves,
    // so cross-runtime non-portability is not an artifact of including
    // Ghost-Ark in the comparison.
    expect(report.divergent_pathologies.length).toBeGreaterThan(0);
  });

  it("records recursion-depth limits as a real divergence class", () => {
    // Rust and Ruby refuse deeply nested input where CPython and jq accept it.
    // A depth limit is an availability boundary that differs per ecosystem, and
    // a receipt that re-verifies in one runtime can be unparseable in another
    // for reasons that have nothing to do with its content.
    const cells = report.cells.filter((cell) => cell.pathologyId === "deep-nesting-depth");
    const verdicts = new Set(cells.map((cell) => cell.verdict));
    expect(verdicts.size, "depth handling must differ across ecosystems").toBeGreaterThan(1);
  });

  it("refuses to emit a census when an arm is unavailable, and explains why", () => {
    // Same guard as E1, for the same reason: independence is the entire point of
    // this experiment, so silently running with three arms would answer a
    // different question under the same name.
    //
    // The first version of this test asserted `not.toThrow()` on a run where all
    // arms WERE available — which exercises nothing, and re-ran the full 31x4
    // census (248 subprocess spawns) so it timed out under parallel load. A
    // one-arm injection tests the branch that matters in milliseconds.
    const unavailable = arms.map((arm, index) =>
      index === 0 ? { ...arm, available: false, detail: "simulated missing runtime" } : arm
    );

    expect(() => runE11(undefined, { arms: unavailable })).toThrow(/are unavailable/u);
    // The message must argue WHY refusing is right, or the next maintainer
    // "fixes" it by passing the flag.
    expect(() => runE11(undefined, { arms: unavailable })).toThrow(/the whole point of this[\s\S]*independence/u);
  });

  // Unlike the test above, this one CANNOT be made cheap by injection: passing
  // `allowDegradedArms` is precisely the branch that does not throw early, so it
  // runs a real census over the three surviving arms — 31 classes x 3 runtimes,
  // ~93 subprocess spawns. That is ~9s alone and over 24s under full-suite
  // parallel load, against a 15s global timeout, so `npm test` went
  // nondeterministically red while the file passed in isolation.
  //
  // The timeout is raised rather than the work removed: the assertion below is
  // about what a degraded report CONTAINS, and a stubbed run would test the stub.
  // Note the sibling test at "refuses to emit a census" was already fixed for
  // this exact timeout in a previous pass and this one was left behind — the same
  // defect, one test lower.
  it("stamps an explicitly-requested degraded run and drops the arm rather than scoring it", () => {
    const unavailable = arms.map((arm, index) =>
      index === 0 ? { ...arm, available: false, detail: "simulated missing runtime" } : arm
    );
    const degraded = runE11(undefined, { arms: unavailable, allowDegradedArms: true });

    expect(degraded.degraded).toBe(true);
    expect(degraded.excluded_arms.map((arm) => arm.armId)).toEqual([arms[0]?.id]);
    // ABSENT, not present-and-fail-closed. A uniformly fail-closed arm stops
    // being a deciding arm and silently leaves the universality quantifier —
    // the exact defect E1 carried before its arm-availability fix.
    expect(degraded.arms.map((arm) => arm.armId)).not.toContain(arms[0]?.id);
    expect(degraded.arms).toHaveLength(3);
  }, 120_000);

  it("carries a non-claim that does not accuse any library of a defect", () => {
    // Every arm here behaves exactly as documented. The finding is about what
    // canonical JSON identity can express, not about library quality, and the
    // report must not be quotable as the latter.
    expect(report.non_claim).toMatch(/behaves as documented/u);
    expect(report.non_claim).toMatch(/not a security review/u);
  });
});
