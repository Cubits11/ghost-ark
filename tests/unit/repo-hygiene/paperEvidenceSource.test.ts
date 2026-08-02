import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Keeps the conference manuscript from sourcing evidence out of `dab/bench/`.
 *
 * `dab/bench/` is quarantined: its own README opens "QUARANTINED: not evidence
 * about Ghost-Ark", because several suites there report `detected: true` while
 * invoking no component under test. Its files import only `node:crypto` and
 * `node:perf_hooks`.
 *
 * That was recorded as R1 — against the *dissertation*. It was never propagated
 * to `docs/paper/main.tex`, which went on headlining `global_advantage: 0` and
 * an end-to-end `p50 = 5.5 us` from that directory, in its abstract, its
 * contributions list, and its artifact appendix, with no retraction section
 * anywhere in the file. Found and corrected 2026-08-02 as R10.
 *
 * The shape of the failure is worth naming, because it is the third instance:
 * a correction landed in the document where the defect was noticed and nowhere
 * else. `retractionSync.test.ts` pins EXPERIMENTS.md against the dissertation.
 * This file pins the manuscript against the quarantine.
 *
 * No LaTeX toolchain is assumed, so this checks the source, not a built PDF.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const PAPER = "docs/paper/main.tex";

const tex = readFileSync(resolve(REPO_ROOT, PAPER), "utf8");
const lines = tex.split("\n");

/** LaTeX built-ins legitimately invoked with empty braces. */
const LATEX_BUILTINS = new Set(["date"]);

/**
 * Markers that make a `dab/bench` mention a disclosure rather than a citation.
 * A mention is allowed only inside a window containing one of these.
 */
const NON_EVIDENCE_MARKERS = [
  "quarantined",
  "retracted source",
  "retract",
  "model-internal",
  "not evidence",
  "superseded"
].map((marker) => marker.toLowerCase());

const WINDOW = 12;

describe("the manuscript does not source evidence from the quarantined bench", () => {
  it("mentions dab/bench only inside a disclosed non-evidence context", () => {
    // The load-bearing assertion. Not "never mention it" — the paper must be
    // able to describe what it retracted — but "never mention it without
    // saying, right there, that it is not evidence".
    const offenders: string[] = [];
    lines.forEach((line, index) => {
      if (!line.includes("dab/bench") && !line.includes("dab\\bench")) return;
      const window = lines
        .slice(Math.max(0, index - WINDOW), index + WINDOW + 1)
        .join("\n")
        .toLowerCase();
      const disclosed = NON_EVIDENCE_MARKERS.some((marker) => window.includes(marker));
      if (!disclosed) offenders.push(`${PAPER}:${index + 1}: ${line.trim()}`);
    });
    expect(offenders, "dab/bench cited without a non-evidence disclosure").toEqual([]);
  });

  it("does not cite the quarantined harness as a reproduction command", () => {
    // The specific regression: the artifact appendix used to map a paper table
    // to `node --experimental-strip-types dab/bench/run_all.ts --trials 10000`,
    // telling a reviewer to reproduce a headline number from a directory whose
    // README says its output is not evidence.
    //
    // Scoped to the appendix rather than the whole file: the retraction text
    // must be free to NAME the command it withdrew. Banning the string outright
    // would make the disclosure unwritable, which is how disclosures get
    // dropped.
    const start = tex.indexOf("\\subsection{Claims mapped to commands}");
    expect(start, "artifact appendix section missing").toBeGreaterThan(-1);
    const appendix = tex.slice(start);
    expect(appendix).not.toMatch(/run\\?_all\.ts/u);
    expect(appendix).not.toContain("dab/bench");
  });

  it("cites the superseding experiments by their real npm scripts", () => {
    // These must exist in package.json; a command that does not run is the
    // defect `npm run claims:verify` exists to catch.
    for (const command of ["experiment:e2", "experiment:e3", "experiment:e4"]) {
      expect(tex, `manuscript should cite ${command}`).toContain(command);
    }
  });

  it("withdraws the throughput and stage-decomposition figures outright", () => {
    // These were withdrawn WITHOUT replacement: E2 measures verification cost,
    // not throughput, and no experiment measures the old stage split. Silently
    // re-sourcing them to a different number would be worse than dropping them.
    const withdrawn = ["140{,}941", "2{,}019{,}173", "248{,}275", "870{,}902"];
    const survivors = withdrawn.filter((value) => tex.includes(value));
    expect(survivors, "a figure withdrawn without replacement reappeared").toEqual([]);
  });

  it("carries a superseded-evidence section the retraction text can point at", () => {
    expect(tex).toContain("\\label{sec:superseded}");
    // retractionSync.test.ts allows retracted phrases to appear in this file
    // *because* this section exists. If it is deleted, that allowance becomes a
    // hole, so the two tests are deliberately coupled here.
    expect(tex).toMatch(/Superseded evidence/u);
  });

  it("reports latency as p50 with IQR, never a bare p50", () => {
    // The repository's first empirical rule. The retracted harness reported no
    // dispersion at all.
    expect(tex).toMatch(/IQR/u);
    expect(tex).toContain("\\evtwohmaciqr");
  });

  it("states a host for the timing claim", () => {
    expect(tex).toContain("\\evtwohost");
  });

  it("defines every macro it invokes", () => {
    // Stands in for a compile: with no LaTeX toolchain available, an undefined
    // macro would otherwise surface only at build time, and re-sourcing the
    // evidence block is exactly the edit that produces one.
    const defined = new Set(
      [...tex.matchAll(/\\newcommand\{\\([A-Za-z]+)\}/gu)].map((match) => match[1] as string)
    );
    const invoked = new Set(
      [...tex.matchAll(/\\([A-Za-z]+)\{\}/gu)].map((match) => match[1] as string)
    );
    const undefinedMacros = [...invoked].filter(
      (name) => !defined.has(name) && !LATEX_BUILTINS.has(name)
    );
    expect(undefinedMacros, "macro invoked but never defined").toEqual([]);
  });

  it("resolves every cross-reference to a declared label", () => {
    // Removing the security-games table is precisely the kind of edit that
    // leaves a dangling \ref behind; one did survive the first pass.
    const labels = new Set(
      [...tex.matchAll(/\\label\{([^}]+)\}/gu)].map((match) => match[1] as string)
    );
    const refs = new Set(
      [...tex.matchAll(/\\(?:page)?ref\{([^}]+)\}/gu)].map((match) => match[1] as string)
    );
    const dangling = [...refs].filter((name) => !labels.has(name));
    expect(dangling, "reference to a label that does not exist").toEqual([]);
  });
});
