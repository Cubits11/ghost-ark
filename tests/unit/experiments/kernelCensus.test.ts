import { describe, expect, it } from "vitest";
import { PATHOLOGY_ALPHABET, assertAlphabetWellFormed } from "../../../tools/experiments/kernelAlphabet";
import { runE1Census } from "../../../tools/experiments/e1KernelCensus";

/**
 * The intent column of the pathology alphabet is the pre-registration for E1. If it
 * can be silently edited to match a measured result, the experiment proves nothing.
 * This map pins every declared intent. Changing an intent requires changing this test
 * too, which makes the change visible in review — that is the whole point.
 */
const PINNED_INTENTS: Record<string, "distinct" | "equivalent"> = {
  "duplicate-key-last-wins": "distinct",
  "integer-precision-loss": "distinct",
  "decimal-literal-collapse": "distinct",
  "non-finite-overflow": "distinct",
  "lone-surrogate-escape": "distinct",
  "unicode-nfc-vs-nfd": "equivalent",
  "object-key-order": "equivalent",
  "insignificant-whitespace": "equivalent",
  "escaped-vs-literal-char": "equivalent",
  "numeric-exponent-form": "equivalent",
  "negative-zero": "equivalent",
  "string-vs-number-type": "distinct",
  "nested-duplicate-key-in-array": "distinct",
  "duplicate-empty-key": "distinct",
  "proto-literal-key": "distinct",
  "array-element-order": "distinct",
  "null-vs-absent-key": "distinct",
  "false-vs-zero": "distinct",
  "empty-string-vs-null": "distinct",
  "float-vs-integer-same-value": "equivalent",
  "trailing-zero-fraction": "equivalent",
  "plus-signed-exponent": "equivalent",
  "uppercase-exponent-marker": "equivalent",
  "escaped-solidus": "equivalent",
  "escape-hex-case": "equivalent",
  "surrogate-pair-vs-literal-astral": "equivalent",
  "key-order-non-ascii": "equivalent",
  "safe-integer-neighbours": "distinct",
  "deep-nesting-depth": "distinct",
  "large-document-single-byte": "distinct",
  "leading-zero-integer": "distinct"
};

describe("E1 pathology alphabet (pre-registration integrity)", () => {
  it("is well-formed: unique ids and byte-distinct pairs", () => {
    expect(() => assertAlphabetWellFormed()).not.toThrow();
  });

  it("pins every pre-registered consumer intent", () => {
    const declared = Object.fromEntries(PATHOLOGY_ALPHABET.map((entry) => [entry.id, entry.intent]));
    expect(declared).toEqual(PINNED_INTENTS);
  });

  it("keeps the NFC/NFD pair genuinely distinct in bytes", () => {
    // Guards the specific hazard that these two literals render identically and can be
    // "tidied" into byte-equality by an editor or a formatter, silently voiding the class.
    const nfcNfd = PATHOLOGY_ALPHABET.find((entry) => entry.id === "unicode-nfc-vs-nfd");
    expect(nfcNfd).toBeDefined();
    expect(nfcNfd?.rawA).not.toBe(nfcNfd?.rawB);
    expect(Buffer.from(nfcNfd?.rawA ?? "", "utf8").equals(Buffer.from(nfcNfd?.rawB ?? "", "utf8"))).toBe(false);
    // They must normalize to the same NFC form, otherwise the class is not testing normalization.
    expect(nfcNfd?.rawA.normalize("NFC")).toBe(nfcNfd?.rawB.normalize("NFC"));
  });

  it("supplies a consumer rationale for every class, so no intent is asserted bare", () => {
    for (const entry of PATHOLOGY_ALPHABET) {
      expect(entry.consumerRationale.length).toBeGreaterThan(40);
    }
  });

  it("rejects an alphabet whose pair is not byte-distinct", () => {
    expect(() =>
      assertAlphabetWellFormed([
        { id: "degenerate", description: "d", rawA: "{}", rawB: "{}", intent: "distinct", consumerRationale: "r" }
      ])
    ).toThrow(/byte-distinct/u);
  });

  it("rejects duplicate pathology ids", () => {
    const entry = PATHOLOGY_ALPHABET[0];
    expect(entry).toBeDefined();
    expect(() => assertAlphabetWellFormed([entry as never, entry as never])).toThrow(/duplicate pathology id/u);
  });
});

describe("E1 kernel census (measured behavior)", () => {
  it("finds the documented unintended kernel members in Ghost-Ark's own canonicalizer", async () => {
    const report = await runE1Census();
    const ghostArk = report.arms.find((arm) => arm.armId === "ghost-ark-receipt-schema");
    expect(ghostArk).toBeDefined();

    // These are real, reproducible defects in this repository's own pipeline. The test
    // asserts they are PRESENT: it is a regression guard on the honesty of the finding,
    // so that "we found unintended kernel members" cannot quietly become false.
    expect(ghostArk?.unintendedKernelMembers).toContain("duplicate-key-last-wins");
    expect(ghostArk?.unintendedKernelMembers).toContain("integer-precision-loss");
    expect(ghostArk?.unintendedKernelMembers).toContain("decimal-literal-collapse");
  }, 120_000);

  it("shows the two Ghost-Ark canonicalizers agree with each other", async () => {
    const report = await runE1Census();
    const schemaArm = report.cells.filter((cell) => cell.armId === "ghost-ark-receipt-schema");
    const verifierArm = report.cells.filter((cell) => cell.armId === "ghost-ark-independent-verifier");

    for (const cell of schemaArm) {
      const counterpart = verifierArm.find((entry) => entry.pathologyId === cell.pathologyId);
      expect(counterpart?.verdict, `divergence on ${cell.pathologyId}`).toBe(cell.verdict);
    }
  }, 120_000);

  it("fails closed on non-finite overflow where the naive control arm issues a false identity", async () => {
    const report = await runE1Census();
    const ghostArk = report.cells.find((cell) => cell.pathologyId === "non-finite-overflow" && cell.armId === "ghost-ark-receipt-schema");
    const naive = report.cells.find((cell) => cell.pathologyId === "non-finite-overflow" && cell.armId === "naive-sorted-stringify");

    // This is the comparative result: Ghost-Ark rejects, the ten-minute homebrew
    // canonicalizer maps two different numbers to one digest via JSON.stringify's
    // Infinity -> null coercion.
    expect(ghostArk?.verdict).toBe("fail-closed");
    expect(naive?.verdict).toBe("unintended-kernel");
  }, 120_000);

  it("demonstrates the kernel is a property of parse-then-canonicalize, not of the canonicalizer alone", async () => {
    const report = await runE1Census();
    const v8Arm = report.cells.find((cell) => cell.pathologyId === "integer-precision-loss" && cell.armId === "ghost-ark-receipt-schema");
    const pythonArm = report.cells.find((cell) => cell.pathologyId === "integer-precision-loss" && cell.armId === "python-json-sorted");

    if (!report.python_probe.available) {
      // Never silently pass: an unavailable arm must be visible, not absorbed.
      expect(pythonArm?.rejectionReasonA ?? pythonArm?.rejectionReasonB).toMatch(/python3 unavailable/u);
      return;
    }

    // Same canonicalization rules, different PARSER: CPython's arbitrary-precision
    // integers preserve a distinction V8's doubles destroy before any canonicalizer runs.
    expect(v8Arm?.verdict).toBe("unintended-kernel");
    expect(pythonArm?.verdict).toBe("sound");
  }, 120_000);

  it("reports census provenance so downstream reporting cannot attach an interval", async () => {
    const report = await runE1Census();
    expect(report.sample_provenance).toBe("census");
    expect(report.non_claim).toMatch(/not a random sample/u);
  }, 120_000);

  it("requires at least two deciding arms before calling a kernel member universal", async () => {
    const report = await runE1Census();
    // non-finite-overflow has exactly one deciding arm (three fail closed), so it must
    // not be promoted to a universal finding.
    expect(report.universal_unintended_kernel).not.toContain("non-finite-overflow");
    expect(report.universal_unintended_kernel).toContain("duplicate-key-last-wins");
  }, 120_000);
});

describe("E1 mitigation arm — strict admission control eliminates the kernel members", () => {
  it("reduces Ghost-Ark's unintended kernel members to zero across the whole alphabet", async () => {
    const report = await runE1Census();
    const unguarded = report.arms.find((arm) => arm.armId === "ghost-ark-receipt-schema");
    const guarded = report.arms.find((arm) => arm.armId === "ghost-ark-strict-admission");

    expect(unguarded).toBeDefined();
    expect(guarded).toBeDefined();

    // The defect, still present on the unguarded path. Widening the alphabet from 12 to 31
    // classes raised this from 3 to 5 -- broadening found MORE defects rather than diluting
    // the finding, which is the honest answer to "your alphabet is curated".
    expect(unguarded?.unintendedKernel).toBe(5);
    // The fix. Built against the original 12 classes and still zero over all 31, so it
    // generalizes rather than being fitted to the cases that motivated it.
    expect(guarded?.unintendedKernel).toBe(0);
    expect(guarded?.unintendedKernelMembers).toEqual([]);
  }, 120_000);

  it("removes them by refusing the pathological document, not by discriminating", async () => {
    const report = await runE1Census();

    // duplicate-key and decimal-literal: side A is refused, side B (the honest document)
    // is still admitted. That is sound-by-rejection, and it means the mitigation does not
    // simply reject everything.
    for (const pathologyId of ["duplicate-key-last-wins", "decimal-literal-collapse", "nested-duplicate-key-in-array", "duplicate-empty-key"]) {
      const cell = report.cells.find((entry) => entry.pathologyId === pathologyId && entry.armId === "ghost-ark-strict-admission");
      expect(cell?.verdict, pathologyId).toBe("sound-by-rejection");
      expect(cell?.observed, pathologyId).toBe("rejected-one");

      // EXACTLY one side keeps an identity. Which side is pathological differs by class —
      // in duplicate-key-last-wins it is rawA, in decimal-literal-collapse it is rawB — so
      // asserting a specific side would encode an accident of how the alphabet is written.
      const withIdentity = [cell?.digestA, cell?.digestB].filter((digest) => digest !== null && digest !== undefined);
      expect(withIdentity, `${pathologyId}: the honest document must still receive an identity`).toHaveLength(1);
    }

    // integer-precision-loss: both sides exceed the safe range, so both are refused.
    const integerCell = report.cells.find((entry) => entry.pathologyId === "integer-precision-loss" && entry.armId === "ghost-ark-strict-admission");
    expect(integerCell?.verdict).toBe("fail-closed");
  }, 120_000);

  it("costs no availability on the equivalent classes", async () => {
    const report = await runE1Census();
    const guarded = report.arms.find((arm) => arm.armId === "ghost-ark-strict-admission");

    // A strict rule that rejected semantically-equivalent documents would trade a soundness
    // defect for an availability defect. Zero rejection-asymmetry means it does not.
    expect(guarded?.rejectionAsymmetry).toBe(0);
    // And it stays sound on everything the unguarded arm was already sound on.
    const unguarded = report.arms.find((arm) => arm.armId === "ghost-ark-receipt-schema");
    expect(guarded?.sound).toBe(unguarded?.sound);
  }, 120_000);
});
