import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { PATHOLOGY_ALPHABET, type PathologyClass } from "../../../tools/experiments/kernelAlphabet";
import { classify } from "../../../tools/experiments/e1KernelCensus";
import type { ArmOutcome } from "../../../tools/experiments/canonicalizerArms";

/**
 * Holds the standalone `kernel-probe.mjs` to its source.
 *
 * The standalone exists so somebody with no interest in this project can point
 * the pathology alphabet at their own canonicalizer: one file, no install, no
 * repository, no account, no trust required. That is the whole value, and it is
 * also the whole risk — a copy that ships to strangers and then drifts from the
 * measurement it claims to be is worse than no copy at all, because the people
 * running it are exactly the people who cannot check.
 *
 * This repository already learned that lesson expensively: a figure measured
 * once, quoted in several documents, corrected in one. Retraction R10 is the
 * same defect in the manuscript. So the standalone is generated, and held here
 * two ways:
 *
 *   ALPHABET PARITY   the embedded corpus must equal the in-repo alphabet
 *                     exactly, field for field.
 *   VERDICT PARITY    the hand-ported `classify` must agree with the census
 *                     implementation on every reachable branch. Two
 *                     implementations of one rule is precisely the situation
 *                     that produces a silent disagreement — which is what E5
 *                     measures across languages, applied here to this project's
 *                     own two copies.
 *
 * Plus the acceptance criterion of plan step 109, executed rather than asserted:
 * the file is copied to a directory outside this repository and run there.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const STANDALONE = resolve(REPO_ROOT, "tools/kernel-probe/kernel-probe.mjs");

interface StandaloneModule {
  PATHOLOGY_ALPHABET: PathologyClass[];
  classify: (
    intent: PathologyClass["intent"],
    a: ArmOutcome,
    b: ArmOutcome
  ) => { observed: string; verdict: string };
  KERNEL_PROBE_SCHEMA_VERSION: string;
}

// Loaded in beforeAll rather than at module scope: a top-level await would
// require a different `module` target than this repository's tsconfig sets, and
// changing that to suit one test is the tail wagging the dog.
let standalone: StandaloneModule;

beforeAll(async () => {
  standalone = (await import(pathToFileURL(STANDALONE).href)) as unknown as StandaloneModule;
});

const source = readFileSync(STANDALONE, "utf8");

describe("standalone kernel-probe stays faithful to its source", () => {
  it("embeds the alphabet byte-for-byte, field for field", () => {
    // Deep equality rather than a length check: a silently edited rationale or
    // a flipped intent would change what the tool reports while keeping the
    // count identical, and the intent column IS the pre-registration.
    expect(standalone.PATHOLOGY_ALPHABET).toEqual(PATHOLOGY_ALPHABET);
  });

  it("carries the same schema version, so reports are comparable", () => {
    expect(standalone.KERNEL_PROBE_SCHEMA_VERSION).toBe("ghost.kernel_probe.v1");
  });

  it("agrees with the census classifier on every reachable branch", () => {
    // Exhaustive over the branch space rather than sampled: two rejection
    // states x two intents, plus collapsed/distinct x two intents. Six of these
    // eight cells decide a verdict name that appears in published output.
    const digestA: ArmOutcome = { status: "digest", digest: "aaa", canonicalForm: "a" };
    const digestSame: ArmOutcome = { status: "digest", digest: "aaa", canonicalForm: "a" };
    const digestB: ArmOutcome = { status: "digest", digest: "bbb", canonicalForm: "b" };
    const rejected: ArmOutcome = { status: "rejected", reason: "exit 1" };

    const pairs: ReadonlyArray<readonly [ArmOutcome, ArmOutcome]> = [
      [digestA, digestSame],
      [digestA, digestB],
      [rejected, rejected],
      [rejected, digestA],
      [digestA, rejected]
    ];

    for (const intent of ["distinct", "equivalent"] as const) {
      for (const [a, b] of pairs) {
        const mine = classify(intent, a, b);
        const theirs = standalone.classify(intent, a, b);
        expect(theirs, `disagreement at intent=${intent} ${a.status}/${b.status}`).toEqual(mine);
      }
    }
  });

  it("declares itself generated, so nobody edits the copy instead of the source", () => {
    expect(source).toContain("GENERATED FILE. Do not edit by hand.");
    expect(source).toContain("build-standalone.mjs");
  });

  it("imports nothing outside the Node standard library", () => {
    // The entire proposition is "one file, no install". A single bare import
    // would silently reintroduce an npm dependency and break that promise for
    // the audience least able to notice.
    const imports = [...source.matchAll(/^import\s.*?from\s+"([^"]+)"/gmu)].map((m) => m[1] as string);
    expect(imports.length).toBeGreaterThan(0);
    const external = imports.filter((specifier) => !specifier.startsWith("node:"));
    expect(external, "standalone must have zero non-builtin imports").toEqual([]);
  });

  it("keeps the non-claim attached to the report", () => {
    // A tool that reports kernel members without its coverage boundary invites
    // exactly the overreading this project exists to refuse.
    expect(source).toContain("not a security review");
    expect(source).toContain("not evidence of safety, correctness, or compliance");
  });
});

describe("standalone kernel-probe runs from a clean directory", () => {
  // Plan step 109's acceptance criterion, executed. Spawns a Node subprocess per
  // pathology side, so it is slow by construction rather than by accident.
  it(
    "produces a correct report with no package.json, node_modules, or repository",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "kernel-probe-cleanroom-"));
      try {
        copyFileSync(STANDALONE, join(dir, "kernel-probe.mjs"));

        // The target is a canonicalizer written into the clean room too, so the
        // test depends on no external binary. `jq` and `python3` are absent on
        // plenty of machines, and a parity test that SKIPS reports green while
        // measuring nothing.
        const canonicalizer = join(dir, "canon.mjs");
        copyFileSync(resolve(REPO_ROOT, "tools/kernel-probe/fixtures/sorted-json-canonicalizer.mjs"), canonicalizer);

        const stdout = execFileSync(
          process.execPath,
          ["kernel-probe.mjs", "--command", `${process.execPath} ${canonicalizer}`, "--json"],
          { cwd: dir, encoding: "utf8", timeout: 120_000 }
        );

        const report = JSON.parse(stdout) as {
          schema_version: string;
          alphabet_size: number;
          sample_provenance: string;
          cells: Array<{ pathologyId: string; verdict: string }>;
          unintended_kernel_members: string[];
          non_claim: string;
        };

        expect(report.schema_version).toBe("ghost.kernel_probe.v1");
        expect(report.alphabet_size).toBe(PATHOLOGY_ALPHABET.length);
        expect(report.sample_provenance).toBe("census");
        expect(report.cells).toHaveLength(PATHOLOGY_ALPHABET.length);
        expect(report.non_claim.length).toBeGreaterThan(100);

        // A sorted-key JSON.stringify canonicalizer MUST collapse duplicate keys:
        // the collapse happens inside JSON.parse, before the canonicalizer runs.
        // If this stops holding, the probe is no longer measuring what it says.
        expect(report.unintended_kernel_members).toContain("duplicate-key-last-wins");

        // Every cell must carry a verdict from the declared vocabulary — a typo
        // in the ported classifier would otherwise surface as `undefined` in a
        // published report.
        const vocabulary = new Set([
          "sound",
          "unintended-kernel",
          "over-discrimination",
          "fail-closed",
          "sound-by-rejection",
          "rejection-asymmetry"
        ]);
        for (const cell of report.cells) {
          expect(vocabulary, `unknown verdict for ${cell.pathologyId}`).toContain(cell.verdict);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000
  );

  it("emits the alphabet so the corpus can be run in another language", () => {
    // The point of --emit-alphabet is that nobody has to use this file, or Node,
    // or trust the classifier: take the corpus and score it yourself.
    const stdout = execFileSync(process.execPath, [STANDALONE, "--emit-alphabet"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    const emitted = JSON.parse(stdout) as PathologyClass[];
    expect(emitted).toEqual(PATHOLOGY_ALPHABET);
  });

  it("exits 2 with usage when given no target, rather than pretending to succeed", () => {
    let status = 0;
    try {
      execFileSync(process.execPath, [STANDALONE], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      status = (error as { status?: number }).status ?? 0;
    }
    expect(status).toBe(2);
  });
});
