import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

interface AlphabetSource {
  kind: string;
  path?: string | null;
  sha256: string;
}

interface StandaloneModule {
  PATHOLOGY_ALPHABET: PathologyClass[];
  classify: (
    intent: PathologyClass["intent"],
    a: ArmOutcome,
    b: ArmOutcome
  ) => { observed: string; verdict: string };
  KERNEL_PROBE_SCHEMA_VERSION: string;
  BUILT_IN_ALPHABET_SHA256: string;
  validateSuppliedAlphabet: (parsed: unknown, label: string) => void;
  probeKernel: (
    command: string,
    args?: readonly string[],
    alphabet?: readonly PathologyClass[],
    runner?: (cmd: string, a: readonly string[], raw: string) => ArmOutcome,
    alphabetSource?: AlphabetSource
  ) => { counts: Record<string, number>; alphabet_source: AlphabetSource };
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
          alphabet_source: { kind: string; sha256: string };
          cells: Array<{ pathologyId: string; verdict: string }>;
          unintended_kernel_members: string[];
          non_claim: string;
        };

        expect(report.schema_version).toBe("ghost.kernel_probe.v1");
        expect(report.alphabet_size).toBe(PATHOLOGY_ALPHABET.length);
        expect(report.sample_provenance).toBe("census");

        // A run with no --alphabet must say so, with the hash of the exact
        // bytes --emit-alphabet writes — the comparability key for reports.
        expect(report.alphabet_source).toEqual({
          kind: "built-in",
          sha256: createHash("sha256")
            .update(`${JSON.stringify(PATHOLOGY_ALPHABET, null, 2)}\n`, "utf8")
            .digest("hex")
        });
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

  it("still runs when invoked through a symlink, which is how an npm bin shim invokes it", () => {
    // Node resolves the ESM main module to its realpath while process.argv[1]
    // keeps the symlink, so a naive path comparison in the am-I-the-main-module
    // check is false precisely when the file is installed as a package bin —
    // and the tool exits 0 having printed NOTHING. Found 2026-08-12 while
    // packaging: the silent no-op shipped in exactly the deployment the
    // package exists for. This drives the file the way `npm i -g` would.
    const dir = mkdtempSync(join(tmpdir(), "kernel-probe-binlink-"));
    try {
      const link = join(dir, "kernel-probe-bin");
      symlinkSync(STANDALONE, link);
      const stdout = execFileSync(process.execPath, [link, "--emit-alphabet"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024
      });
      expect(JSON.parse(stdout)).toEqual(PATHOLOGY_ALPHABET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("supplied alphabet (--alphabet)", () => {
  // E11 answers the "artifact of our implementation" objection. It cannot answer
  // the "artifact of the author's alphabet" one while the only corpus the probe
  // can run is the author's. --alphabet is the tooling half of that answer: a
  // caller can now run THEIR pathology corpus. These guards hold the three
  // properties that make a caller's run meaningful — the emitted corpus round-
  // trips, the supplied corpus is what actually runs and is recorded, and a
  // malformed corpus aborts rather than silently thinning the census.

  // In-process mirror of fixtures/sorted-json-canonicalizer.mjs, so parity
  // checks over the full 31-class alphabet cost zero process spawns.
  function sortedCanonical(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(sortedCanonical).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedCanonical(record[key])}`)
      .join(",")}}`;
  }

  const stubRunner = (_cmd: string, _args: readonly string[], raw: string): ArmOutcome => {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { status: "rejected", reason: "exit 1" };
    }
    const canonical = sortedCanonical(value);
    return {
      status: "digest",
      digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
      canonicalForm: canonical
    };
  };

  it("round-trips its own --emit-alphabet output: validates, hashes as built-in, same counts", () => {
    const emitted = execFileSync(process.execPath, [STANDALONE, "--emit-alphabet"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    const parsed = JSON.parse(emitted) as PathologyClass[];

    expect(() => standalone.validateSuppliedAlphabet(parsed, "emitted")).not.toThrow();

    // The comparability key: a corpus produced by --emit-alphabet must hash
    // byte-identically to the built-in, so a round-tripped report is visibly
    // comparable to a built-in one. Anything else hashes differently and is
    // conservatively not comparable.
    expect(createHash("sha256").update(emitted, "utf8").digest("hex")).toBe(
      standalone.BUILT_IN_ALPHABET_SHA256
    );

    const builtIn = standalone.probeKernel("stub", [], undefined, stubRunner);
    const supplied = standalone.probeKernel("stub", [], parsed, stubRunner);
    expect(supplied.counts).toEqual(builtIn.counts);

    // The supplied run must not be mislabelled built-in even though its content
    // is identical — but its hash must still match, which is what says the two
    // reports may be compared.
    expect(builtIn.alphabet_source.kind).toBe("built-in");
    expect(supplied.alphabet_source.kind).toBe("supplied");
    expect(supplied.alphabet_source.sha256).toBe(builtIn.alphabet_source.sha256);
  });

  it("runs a hand-written corpus through the CLI and records the file's sha256", () => {
    const dir = mkdtempSync(join(tmpdir(), "kernel-probe-alphabet-"));
    try {
      const canonicalizer = join(dir, "canon.mjs");
      copyFileSync(resolve(REPO_ROOT, "tools/kernel-probe/fixtures/sorted-json-canonicalizer.mjs"), canonicalizer);

      // Three classes, one of which a sorted-key canonicalizer is KNOWN to
      // collapse: duplicate keys resolve inside JSON.parse before the
      // canonicalizer runs. If that row does not come back unintended-kernel,
      // the supplied corpus is not what actually ran.
      const corpus = JSON.stringify(
        [
          {
            id: "caller-dup-key",
            description: "Same key twice; JSON.parse keeps the last occurrence.",
            rawA: '{"total":10,"total":20}',
            rawB: '{"total":20}',
            intent: "distinct",
            consumerRationale: "A dispute-resolution consumer distinguishes a contradictory submission from a clean one."
          },
          {
            id: "caller-key-order",
            description: "Same members, different order.",
            rawA: '{"x":1,"y":2}',
            rawB: '{"y":2,"x":1}',
            intent: "equivalent",
            consumerRationale: "No declared consumer depends on member order."
          },
          {
            id: "caller-malformed-side",
            description: "One side is not JSON at all.",
            rawA: '{"v":1',
            rawB: '{"v":1}',
            intent: "distinct",
            consumerRationale: "An admission-control consumer distinguishes a truncated transmission from a complete one."
          }
        ],
        null,
        2
      );
      writeFileSync(join(dir, "corpus.json"), corpus, "utf8");

      const stdout = execFileSync(
        process.execPath,
        [STANDALONE, "--alphabet", "corpus.json", "--command", `${process.execPath} ${canonicalizer}`, "--json"],
        { cwd: dir, encoding: "utf8", timeout: 60_000 }
      );
      const report = JSON.parse(stdout) as {
        alphabet_size: number;
        alphabet_source: { kind: string; path: string; sha256: string };
        unintended_kernel_members: string[];
        counts: Record<string, number>;
      };

      expect(report.alphabet_size).toBe(3);
      expect(report.unintended_kernel_members).toEqual(["caller-dup-key"]);
      expect(report.counts["sound-by-rejection"]).toBe(1);
      expect(report.alphabet_source).toEqual({
        kind: "supplied",
        path: "corpus.json",
        sha256: createHash("sha256").update(corpus, "utf8").digest("hex")
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // Fail-closed rejections. Each corpus is valid except for exactly one defect,
  // so the message asserted is the message for THAT defect — a probe that
  // skipped the class instead of aborting would fail every row here.
  const validClass = {
    id: "ok",
    description: "d",
    rawA: "1",
    rawB: "2",
    intent: "distinct",
    consumerRationale: "r"
  };

  const malformedCases: ReadonlyArray<{ name: string; corpus: string; message: string }> = [
    {
      name: "a class with a missing intent",
      corpus: JSON.stringify([validClass, { ...validClass, id: "no-intent", intent: undefined }]),
      message: 'class "no-intent" has no intent'
    },
    {
      name: "an unknown intent value",
      corpus: JSON.stringify([{ ...validClass, id: "bad-intent", intent: "maybe" }]),
      message: 'class "bad-intent" has unknown intent "maybe"'
    },
    {
      name: "a duplicate id",
      corpus: JSON.stringify([validClass, { ...validClass, rawA: "3", rawB: "4" }]),
      message: 'duplicate pathology id "ok"'
    },
    {
      name: "a pair that is not two documents",
      corpus: JSON.stringify([{ ...validClass, id: "same-sides", rawA: "5", rawB: "5" }]),
      message: 'class "same-sides" is not a pair of two documents'
    },
    {
      name: "a corpus that is not an array",
      corpus: JSON.stringify({ classes: [] }),
      message: "must be a JSON array of pathology classes"
    },
    {
      name: "an empty corpus",
      corpus: "[]",
      message: "contains no pathology classes"
    },
    {
      name: "a file that is not JSON",
      corpus: "{ not json",
      message: "is not valid JSON"
    }
  ];

  for (const { name, corpus, message } of malformedCases) {
    it(`rejects ${name} with a specific message and a non-zero exit`, () => {
      const dir = mkdtempSync(join(tmpdir(), "kernel-probe-malformed-"));
      try {
        writeFileSync(join(dir, "corpus.json"), corpus, "utf8");
        let status = 0;
        let stderr = "";
        try {
          execFileSync(
            process.execPath,
            [STANDALONE, "--alphabet", "corpus.json", "--command", "definitely-not-run"],
            { cwd: dir, encoding: "utf8", stdio: "pipe" }
          );
        } catch (error) {
          const failure = error as { status?: number; stderr?: string };
          status = failure.status ?? 0;
          stderr = failure.stderr ?? "";
        }
        expect(status, `corpus with ${name} must exit non-zero`).toBe(2);
        expect(stderr).toContain(message);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("rejects --alphabet with a missing or unreadable file", () => {
    for (const [args, message] of [
      [[STANDALONE, "--alphabet", "--command", "x"], "--alphabet requires a file path"],
      [[STANDALONE, "--alphabet", "/nonexistent/corpus.json", "--command", "x"], "cannot read alphabet file"]
    ] as ReadonlyArray<[string[], string]>) {
      let status = 0;
      let stderr = "";
      try {
        execFileSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        status = failure.status ?? 0;
        stderr = failure.stderr ?? "";
      }
      expect(status).toBe(2);
      expect(stderr).toContain(message);
    }
  });
});
