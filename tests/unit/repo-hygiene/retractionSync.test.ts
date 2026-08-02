import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Keeps the two retraction lists from drifting apart.
 *
 * This repository retracts claims by listing them rather than deleting them, on
 * the grounds that a quietly removed claim is indistinguishable from one that was
 * never made. That policy created a second-order problem the moment the list
 * appeared in two places: `docs/research/EXPERIMENTS.md` (the source of record)
 * and the dissertation's §6.0.
 *
 * They had already drifted, in BOTH directions, before this test existed:
 *
 *   - R6 (the eBPF "Mitigations implemented for Zero-Days" banner), R7 (the
 *     tla2tools pin that verified nothing) and R8 (Nitro PCR attestation) were
 *     recorded in EXPERIMENTS.md and never propagated to the chapter;
 *   - R9 (`prototype_pollution: detected: false`) was retracted in the chapter
 *     and never propagated to EXPERIMENTS.md.
 *
 * A reader consulting either document alone would have got an incomplete list of
 * what this project has withdrawn — which is a worse failure than the original
 * overclaims, because it is the correction that is incomplete.
 *
 * Stable IDs rather than prose matching: the two documents word the same
 * retraction differently on purpose (one is a table of record, the other is
 * chapter narrative), so any text-similarity check would either be too loose to
 * catch drift or too tight to allow editing.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), "utf8");
}

/** Pulls `| **Rn** |` row ids out of one delimited section. */
function retractionIds(source: string, startMarker: string, endMarker: string): string[] {
  const start = source.indexOf(startMarker);
  expect(start, `missing section: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `missing section end: ${endMarker}`).toBeGreaterThan(-1);
  const section = source.slice(start, end);
  return [...section.matchAll(/^\|\s*\*\*(R\d+)\*\*\s*\|/gmu)].map((match) => match[1] as string);
}

const experimentsIds = retractionIds(read("docs/research/EXPERIMENTS.md"), "## Retractions", "## Open gaps");
const dissertationIds = retractionIds(
  read("docs/dissertation/04_Empirical_Evaluation.md"),
  "### 6.0 Retractions",
  "### 6.1"
);

describe("retraction lists stay in sync", () => {
  it("records at least the ten retractions known at 2026-08-02", () => {
    // A floor, not an equality: retracting more is progress. Retracting FEWER
    // means a withdrawal was quietly dropped, which is the failure this file
    // exists to prevent.
    expect(experimentsIds.length).toBeGreaterThanOrEqual(10);
  });

  it("assigns every retraction a unique id in the source of record", () => {
    expect(new Set(experimentsIds).size).toBe(experimentsIds.length);
  });

  it("assigns every retraction a unique id in the dissertation", () => {
    expect(new Set(dissertationIds).size).toBe(dissertationIds.length);
  });

  it("carries the same retraction set in both documents", () => {
    // The load-bearing assertion. Equality in both directions: a retraction in
    // EXPERIMENTS.md missing from the chapter leaves a reader of the chapter
    // with a stale picture, and one in the chapter missing from EXPERIMENTS.md
    // means the source of record is not one.
    expect([...dissertationIds].sort()).toEqual([...experimentsIds].sort());
  });

  it("numbers ids contiguously from R1, so a gap signals a deleted retraction", () => {
    const numbers = experimentsIds.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
  });

  it("names EXPERIMENTS.md as the source of record inside the dissertation", () => {
    // Two lists need a tie-breaker. Without one, a future disagreement has no
    // resolution procedure and both documents look equally authoritative.
    const chapter = read("docs/dissertation/04_Empirical_Evaluation.md");
    expect(chapter).toMatch(/source of record/u);
    expect(chapter).toContain("EXPERIMENTS.md");
  });

  it("keeps every retracted claim string out of live prose", () => {
    // A retracted phrase may appear in a retraction table, in a test that pins
    // it, or in a quarantined prototype. Anywhere else it is a live claim again.
    const retractedPhrases = ["entirely eradicated", "robust statistical lower bound"];
    const allowed = [
      "docs/research/EXPERIMENTS.md",
      "docs/dissertation/04_Empirical_Evaluation.md",
      // Added 2026-08-02 with R10: the manuscript now carries its own
      // §Superseded evidence, so these phrases appear there as retractions.
      // It is an allowed context only because that section exists —
      // paperEvidenceSource.test.ts asserts it still does.
      "docs/paper/main.tex",
      "docs/artifact/STATUS_AND_LIMITATIONS.md",
      "CLAUDE.md",
      "CONTRIBUTING.md",
      "packages/research-frontier/src/stats/descriptive.ts",
      "tests/unit/experiments/descriptiveStats.test.ts",
      "tests/unit/repo-hygiene/retractionSync.test.ts"
    ];
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    for (const phrase of retractedPhrases) {
      let hits: string[] = [];
      try {
        hits = execFileSync("git", ["grep", "-l", "--", phrase], { cwd: REPO_ROOT, encoding: "utf8" })
          .split("\n")
          .filter((line) => line.length > 0);
      } catch {
        hits = []; // git grep exits 1 on no match.
      }
      const offenders = hits.filter((file) => !allowed.includes(file));
      expect(offenders, `"${phrase}" appears outside its retraction context`).toEqual([]);
    }
  });
});
