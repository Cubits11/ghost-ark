import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every command a reviewer is told to run must exist.
 *
 * `npm run claims:verify` executes the commands in the claim-evidence matrix,
 * which closed that hole for `docs/governance/claim-evidence-matrix.md`. It does
 * not cover the documents a reviewer actually starts from — `README-AE.md`,
 * `ARTIFACT_EVALUATION.md`, `README.md`, or the manuscript's artifact appendix.
 * A renamed npm script or Makefile target leaves those silently wrong, and the
 * failure surfaces in front of the reviewer rather than in CI.
 *
 * This checks EXISTENCE, not success. A command can exist and measure nothing —
 * that is E4's department, and `claims:verify` carries the same non-claim.
 * Existence is still the floor: a citation that cannot even be invoked is not
 * evidence of anything, and it is the cheapest possible thing to check.
 *
 * Only commands written as code are considered — inside backticks or a fenced
 * block. Prose like "make the argument" is English, not a target, and matching
 * it produced false positives on the first pass.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), "utf8");
}

/** Reviewer-facing entry points: what someone lands on and types. */
const REVIEWER_DOCS = [
  "README.md",
  "README-AE.md",
  "ARTIFACT_EVALUATION.md",
  "CONTRIBUTING.md",
  "docs/paper/main.tex",
  "docs/artifact/CI_COVERAGE.md",
  "docs/artifact/REVIEWER_ATTACK_SHEET.md",
  "docs/research/00_THESIS.md",
  "docs/research/EXPERIMENTS.md"
];

const NPM_SCRIPTS: ReadonlySet<string> = new Set(
  Object.keys(
    (JSON.parse(read("package.json")) as { scripts?: Record<string, unknown> }).scripts ?? {}
  )
);

const MAKE_TARGETS: ReadonlySet<string> = new Set(
  [...read("Makefile").matchAll(/^([a-z][a-z0-9_-]*):/gmu)].map((match) => match[1] as string)
);

/**
 * Pull the code-formatted spans out of a document: inline backticks, fenced
 * blocks, and LaTeX \texttt{}/verbatim. Prose is deliberately excluded.
 */
function codeSpans(source: string, isLatex: boolean): string[] {
  const spans: string[] = [];
  if (isLatex) {
    // A backtick is NOT code in LaTeX — it opens a quotation (``Fast''). Reading
    // it as code made every quoted phrase in the manuscript look like a command
    // span, which is how `make the` and `make its` were first reported as
    // missing Makefile targets. They are English.
    for (const match of source.matchAll(/\\texttt\{([^}]*)\}/gu)) spans.push(match[1] as string);
    for (const match of source.matchAll(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/gu)) {
      spans.push(match[1] as string);
    }
    return spans;
  }
  for (const match of source.matchAll(/`{1,3}([^`]+)`{1,3}/gu)) spans.push(match[1] as string);
  return spans;
}

interface Citation {
  readonly doc: string;
  readonly kind: "npm" | "make";
  readonly name: string;
}

function citations(): Citation[] {
  const found: Citation[] = [];
  for (const doc of REVIEWER_DOCS) {
    let source: string;
    try {
      source = read(doc);
    } catch {
      continue; // A missing reviewer doc is docs:check's job, not this file's.
    }
    for (const span of codeSpans(source, doc.endsWith(".tex"))) {
      // LaTeX escapes underscores and hyphens; normalise before lookup.
      const text = span.replace(/\\_/gu, "_").replace(/-\{\}-/gu, "--");
      for (const match of text.matchAll(/npm run ([a-zA-Z][a-zA-Z0-9:_-]*)/gu)) {
        found.push({ doc, kind: "npm", name: match[1] as string });
      }
      for (const match of text.matchAll(/\bmake ([a-z][a-z0-9_-]*)/gu)) {
        found.push({ doc, kind: "make", name: match[1] as string });
      }
    }
  }
  return found;
}

const CITATIONS = citations();

describe("commands cited to reviewers actually exist", () => {
  it("finds citations to check, so the guard cannot pass vacuously", () => {
    // Without this, a change to the extraction regex would silently reduce this
    // file to an expensive no-op reporting green — the E4 tautology defect
    // applied to a hygiene test.
    expect(CITATIONS.length).toBeGreaterThan(20);
    expect(CITATIONS.some((c) => c.kind === "npm")).toBe(true);
    expect(CITATIONS.some((c) => c.kind === "make")).toBe(true);
  });

  it("resolves every cited npm script to package.json", () => {
    const broken = CITATIONS.filter((c) => c.kind === "npm" && !NPM_SCRIPTS.has(c.name)).map(
      (c) => `${c.doc} cites "npm run ${c.name}", which is not in package.json`
    );
    expect([...new Set(broken)]).toEqual([]);
  });

  it("resolves every cited make target to the Makefile", () => {
    const broken = CITATIONS.filter((c) => c.kind === "make" && !MAKE_TARGETS.has(c.name)).map(
      (c) => `${c.doc} cites "make ${c.name}", which is not a Makefile target`
    );
    expect([...new Set(broken)]).toEqual([]);
  });

  it("keeps the experiment scripts the retraction re-sourced evidence onto", () => {
    // R10 moved the manuscript's detection and cost claims off the quarantined
    // bench and onto these. If one is renamed, the retraction's replacement
    // evidence silently stops existing, which would be worse than the original
    // defect: the paper would cite a command nobody can run, in the very section
    // that explains why the previous command was untrustworthy.
    for (const script of ["experiment:e2", "experiment:e3", "experiment:e4", "experiment:e5"]) {
      expect(NPM_SCRIPTS, `${script} is load-bearing for retraction R10`).toContain(script);
    }
  });
});
