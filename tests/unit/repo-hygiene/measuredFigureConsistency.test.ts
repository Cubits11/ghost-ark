import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Pins measured figures against drift ACROSS documents.
 *
 * Every defect found in the 2026-08-02 Phase 0 audit had one shape: a number
 * measured once, quoted in several documents, then re-measured in exactly one of
 * them. The corrections were applied where the defect was noticed and nowhere
 * else. Concretely, on that day:
 *
 *   - E3's verifier-intrinsic count was 26/26 live and 25/25 in README.md,
 *     00_THESIS.md, the dissertation, and the reviewer attack sheet;
 *   - E5's peer-unanimity count was 28/28 live and 25/25 in three documents;
 *   - E7's divergence-class count was 8 live and 4 in four documents;
 *   - E1's alphabet was 31 classes live and 12 in README.md and the dissertation,
 *     while EXPERIMENTS.md already had it right — the update reached the source
 *     of record and stopped there;
 *   - the test suite was 1223/159 while three documents claimed three DIFFERENT
 *     stale values (706/105, 706/105, 640/97), two of them labelled "exact";
 *   - the Rust gateway ran 13 tests while README-AE claimed 7.
 *
 * `retractionSync.test.ts` solved this for retractions. This file solves it for
 * measured figures, and `paperEvidenceSource.test.ts` solves it for the source
 * a figure is drawn from. All three exist because the same failure recurred in
 * a place nobody had thought to check.
 *
 * WHAT THIS DOES NOT DO. It enforces *agreement*, not *truth*: every document
 * could agree on a wrong number and this file would pass. Truth is the job of
 * the experiment harnesses, which re-derive their figures from a real run — see
 * the `command` on each fact below, and E4, which checks that a detection stops
 * when its mechanism is broken. Tier 1 below is the exception: those figures are
 * recomputed from the tracked tree, so they ARE checked against ground truth.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), "utf8");
}

// ---------------------------------------------------------------------------
// Tier 1 — ground truth, recomputed from the tracked tree on every run.
// ---------------------------------------------------------------------------

const MALICIOUS_FIXTURES = new Set(
  git(["ls-files", "examples/malicious-receipts/receipts"])
    .map((path) => /\/(MAL-\d+)/u.exec(path)?.[1])
    .filter((id): id is string => Boolean(id))
);

const TLC_LOGS = git(["ls-files", "proofs/*/artifacts/*.tlc.txt"]).map(
  (path) => path.split("/").pop()?.replace(/\.tlc\.txt$/u, "") ?? ""
);
const TLC_MUTANTS = TLC_LOGS.filter((name) => /mutant/iu.test(name));
const TLC_BASELINES = TLC_LOGS.filter((name) => !/mutant/iu.test(name));

// ---------------------------------------------------------------------------
// Tier 2 — cross-document consistency for figures that require a run.
// ---------------------------------------------------------------------------

/**
 * Documents whose filename carries a date are snapshots of what was true then.
 * Rewriting them to today's numbers would destroy the record they exist to keep.
 */
const DATED_SNAPSHOT = /docs\/validation\/.*_20\d\d-\d\d-\d\d\.md$/u;

/**
 * A line may legitimately quote a superseded value while correcting it — that is
 * this repository's retraction policy, which lists rather than deletes. Without
 * this allowance the guard would fire on every honest correction, and the third
 * person it annoys would delete it.
 */
const SUPERSESSION =
  /previously|prior|was stale|had drifted|until 20\d\d|earlier|historical|supersed|re-measured|corrected|stale by|retract|\d[\d,/.]*\s*(?:→|->)\s*\d/iu;

/**
 * The arrow is deliberately NOT a bare alternative above. It was, briefly, to
 * allow correction notation like "829→831" — and because this repository's
 * READMEs use `→` as an ordinary link arrow ("Threat Model → ..."), that one
 * character made the guard blind on most of every reading map and table. The
 * discriminator probe caught it: a reintroduced defect on a line containing `→`
 * did not fail the test. Correction notation now requires digits on both sides,
 * which is what it actually looks like.
 */

interface Fact {
  readonly id: string;
  /** Accepted spellings, lowercased. Documents format numbers differently. */
  readonly expect: readonly string[];
  /** Context-anchored; group 1 (or the first defined group) captures the figure. */
  readonly pattern: RegExp;
  /** Lines matching this are a different quantity that the pattern over-matches. */
  readonly exempt?: RegExp;
  /** How to re-derive the figure. A fact nobody can re-measure is an assertion. */
  readonly command: string;
  readonly measuredOn: string;
}

const FACTS: readonly Fact[] = [
  {
    id: "e3-verifier-intrinsic",
    expect: ["26/26"],
    pattern:
      /verifier[- ]intrinsic[^0-9\n]{0,60}?(\d+\/\d+)|(\d+\/\d+)\s*(?:rejected by verifier rules|verifier[- ]intrinsic)/giu,
    command: "npm run experiment:e3",
    measuredOn: "2026-08-02"
  },
  {
    id: "e5-peer-unanimity-fail",
    expect: ["28/28"],
    pattern:
      /unanimous on fixtures that must FAIL[^0-9\n]{0,20}(\d+\/\d+)|(\d+\/\d+)\s*rejects and/giu,
    command: "npm run experiment:e5",
    measuredOn: "2026-08-02"
  },
  {
    id: "e7-structural-divergence-classes",
    expect: ["8", "eight"],
    pattern:
      /([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:distinct\s+)?structural divergence classes/giu,
    command: "npm run experiment:e7",
    measuredOn: "2026-08-02"
  },
  {
    id: "e1-pathology-classes",
    expect: ["31"],
    pattern: /\b(\d+)\s+(?:pre-registered\s+)?pathology classes/giu,
    command: "npm run experiment:e1",
    measuredOn: "2026-08-02"
  },
  {
    id: "e1-unintended-kernel-members",
    expect: ["5", "five"],
    pattern:
      /([0-9]+|three|four|five|six)\s+unintended kernel members\b(?!\s*(?:in every|across))/giu,
    // `ghost-ark-strict-admission` is the MITIGATION arm and carries 0 by
    // design. That is the fix working, not a stale figure.
    exempt: /strict[- ]admission/iu,
    command: "npm run experiment:e1",
    measuredOn: "2026-08-02"
  },
  {
    id: "malicious-corpus-size",
    expect: ["30"],
    pattern: /\b(\d+)[- ]fixture (?:malicious )?corpus/giu,
    command: "ls examples/malicious-receipts/receipts",
    measuredOn: "2026-08-02"
  },
  {
    id: "rust-gateway-tests",
    expect: ["13"],
    pattern: /gateway (\d+) \+ verifier/giu,
    command: "cd dab/gateway && cargo test --locked",
    measuredOn: "2026-08-02"
  }
];

const PROSE_FILES = git(["ls-files", "*.md", "*.tex"]).filter(
  (path) => !DATED_SNAPSHOT.test(path)
);

interface Offence {
  readonly location: string;
  readonly line: string;
  readonly found: string;
}

function scan(fact: Fact): Offence[] {
  const offences: Offence[] = [];
  for (const file of PROSE_FILES) {
    const lines = read(file).split("\n");
    lines.forEach((line, index) => {
      if (fact.exempt?.test(line)) return;
      for (const match of line.matchAll(fact.pattern)) {
        const found = match.slice(1).find((group) => group !== undefined);
        if (found === undefined) continue;
        if (fact.expect.includes(found.toLowerCase())) continue;
        const window = lines.slice(Math.max(0, index - 2), index + 3).join(" ");
        if (SUPERSESSION.test(window)) continue;
        offences.push({ location: `${file}:${index + 1}`, line: line.trim().slice(0, 100), found });
      }
    });
  }
  return offences;
}

describe("measured figures agree across every document that quotes them", () => {
  describe("tier 1 — recomputed from the tracked tree (ground truth)", () => {
    it("has exactly the malicious corpus the documents claim", () => {
      expect(MALICIOUS_FIXTURES.size).toBe(30);
    });

    it("numbers malicious fixtures contiguously, so a deleted one leaves a gap", () => {
      const numbers = [...MALICIOUS_FIXTURES]
        .map((id) => Number(id.slice(4)))
        .sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    });

    it("ships five TLC baselines and four mutants, not five of each", () => {
      // The manuscript claimed "five seeded mutants" until 2026-08-02. There are
      // four. Mutants are how this project argues its invariants have teeth, so
      // claiming one that does not exist claims a two-sided oracle that is
      // one-sided for that spec.
      expect(TLC_BASELINES).toHaveLength(5);
      expect(TLC_MUTANTS).toHaveLength(4);
    });

    it("records DAB_ExecutionBoundary as the baseline with no mutant", () => {
      // Named explicitly: if someone later adds its mutant, this test fails and
      // forces the prose describing the gap to be updated in the same commit.
      const withMutant = new Set(TLC_MUTANTS.map((name) => name.replace(/_?Mutant$/iu, "")));
      const unpaired = TLC_BASELINES.filter((name) => !withMutant.has(name));
      expect(unpaired).toEqual(["DAB_ExecutionBoundary"]);
    });

    it("never describes a mutantless spec as having a mutant", () => {
      // README.md line 103 read: "proofs/tla/ (tenant isolation, speculative
      // collapse, transport boundary — each with a mutant showing the property
      // is load-bearing)". It named the ONE spec with no mutant, omitted one
      // that has one, and asserted "each". A reviewer following that link lands
      // on a 38-line stub. CI_COVERAGE already listed the stub as a known gap,
      // so the README contradicted it.
      const specs = git(["ls-files", "proofs/*/*.tla"])
        .map((path) => path.split("/").pop()?.replace(/\.tla$/u, "") ?? "")
        .filter((name) => name.length > 0 && !name.includes("TTrace") && !/mutant/iu.test(name));
      const paired = new Set(TLC_MUTANTS.map((name) => name.replace(/_?Mutant$/iu, "")));
      const mutantless = specs.filter((name) => !paired.has(name));
      // Sanity: if this list empties, the guard below silently stops guarding.
      expect(mutantless.length).toBeGreaterThan(0);

      // The disclaimer usually sits on a NEARBY line, not the same one — prose
      // wraps. A single-line exemption produced three false positives against
      // correct text on the first run, which is how a guard gets switched off.
      const DISCLAIMED = /\bno (?:seeded )?mutant|without a mutant|\bstubs?\b|one-sided|not gated|excluded/iu;
      const offences: string[] = [];
      for (const file of PROSE_FILES) {
        const lines = read(file).split("\n");
        lines.forEach((line, index) => {
          const window = lines.slice(Math.max(0, index - 2), index + 3).join(" ");
          if (SUPERSESSION.test(window) || DISCLAIMED.test(window)) return;
          if (!/\bmutants?\b/iu.test(line)) return;
          for (const spec of mutantless) {
            // Match the spec by its identifier or its spaced-out prose form
            // ("TenantIsolation" / "tenant isolation").
            const prose = spec.replace(/([a-z])([A-Z])/gu, "$1 $2");
            if (new RegExp(`${spec}|${prose}`, "iu").test(line)) {
              offences.push(
                `${file}:${index + 1} claims a mutant for ${spec}: ${line.trim().slice(0, 90)}`
              );
            }
          }
        });
      }
      expect(offences, "a spec with no mutant is described as having one").toEqual([]);
    });

    it("commits a TLC log for every mutant spec it ships", () => {
      const specs = git(["ls-files", "proofs/*/*Mutant*.tla"])
        .map((path) => path.split("/").pop()?.replace(/\.tla$/u, "") ?? "")
        .filter((name) => !name.includes("TTrace"));
      for (const spec of specs) {
        expect(TLC_MUTANTS, `no recorded TLC log for ${spec}`).toContain(spec);
      }
    });
  });

  describe("tier 1b — the test-suite figure, stated in four places", () => {
    /**
     * On 2026-08-02 this single figure was wrong in three documents with three
     * DIFFERENT values — 706/105 in the manuscript, 706/105 in README-AE (row
     * labelled "exact"), and 640/97 in docs/paper/README.md — against an actual
     * 1223/159. Extraction is location-specific rather than corpus-wide: the
     * phrase "N tests" is far too common in this repository for a general
     * pattern to be anything but noise.
     */
    const digits = (raw: string): number => Number(raw.replace(/[^0-9]/gu, ""));

    const SITES: ReadonlyArray<{
      readonly file: string;
      readonly tests: RegExp;
      readonly files: RegExp;
    }> = [
      {
        file: "docs/paper/main.tex",
        tests: /\\newcommand\{\\testcount\}\{([\d{},]+)\}/u,
        files: /\\newcommand\{\\testfiles\}\{([\d{},]+)\}/u
      },
      {
        file: "README-AE.md",
        tests: /([\d,]+) tests \/ [\d,]+ files pass at HEAD/u,
        files: /[\d,]+ tests \/ ([\d,]+) files pass at HEAD/u
      },
      {
        file: "docs/paper/README.md",
        tests: /Test counts \(([\d,]+) \/ [\d,]+\)/u,
        files: /Test counts \([\d,]+ \/ ([\d,]+)\)/u
      },
      {
        file: "AGENTS.md",
        tests: /([\d,]+) tests \(1 file/u,
        files: /npm test passes: ([\d,]+) test files/u
      }
    ];

    it("extracts the figure from every site, so none can drop out silently", () => {
      for (const site of SITES) {
        const source = read(site.file);
        expect(site.tests.exec(source)?.[1], `no test count found in ${site.file}`).toBeDefined();
        expect(site.files.exec(source)?.[1], `no file count found in ${site.file}`).toBeDefined();
      }
    });

    it("agrees on the test and file counts across all four", () => {
      const readings = SITES.map((site) => {
        const source = read(site.file);
        return {
          file: site.file,
          tests: digits(site.tests.exec(source)?.[1] ?? ""),
          files: digits(site.files.exec(source)?.[1] ?? "")
        };
      });
      const distinctTests = new Set(readings.map((r) => r.tests));
      const distinctFiles = new Set(readings.map((r) => r.files));
      const detail = readings.map((r) => `\n  ${r.file}: ${r.tests} tests / ${r.files} files`).join("");
      expect(distinctTests.size, `test counts disagree:${detail}`).toBe(1);
      expect(distinctFiles.size, `file counts disagree:${detail}`).toBe(1);
    });

    it("states a figure that is plausible for this suite", () => {
      // A floor, not equality: the count is commit-relative and rises as tests
      // are added. A DECREASE is the case worth catching, and pinning equality
      // here would make the guard fail every time someone writes a test — which
      // is how a guard earns a blanket skip.
      const source = read("AGENTS.md");
      expect(digits(/([\d,]+) tests \(1 file/u.exec(source)?.[1] ?? "0")).toBeGreaterThanOrEqual(1253);
      expect(digits(/npm test passes: ([\d,]+) test files/u.exec(source)?.[1] ?? "0")).toBeGreaterThanOrEqual(162);
    });
  });

  describe("tier 2 — cross-document agreement", () => {
    it.each(FACTS.map((fact) => [fact.id, fact] as const))(
      "%s is quoted consistently everywhere",
      (_id, fact) => {
        const offences = scan(fact);
        const detail = offences
          .map((o) => `\n  ${o.location} -> "${o.found}"  ${o.line}`)
          .join("");
        expect(
          offences,
          `stale figure for ${fact.id} (expected ${fact.expect.join(" or ")}). ` +
            `Re-derive with: ${fact.command} (last measured ${fact.measuredOn}).` +
            detail
        ).toEqual([]);
      }
    );

    it("actually finds the figures it claims to guard", () => {
      // Without this, a regex that silently stops matching would report green
      // forever — a guard that measures nothing, which is the E4 defect applied
      // to a hygiene test. Every fact must match somewhere in the corpus.
      for (const fact of FACTS) {
        let hits = 0;
        for (const file of PROSE_FILES) {
          for (const _ of read(file).matchAll(fact.pattern)) hits++;
        }
        expect(hits, `${fact.id} matched nothing — its pattern has rotted`).toBeGreaterThan(0);
      }
    });
  });
});
