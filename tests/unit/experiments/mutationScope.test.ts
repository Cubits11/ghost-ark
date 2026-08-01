import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MUTATION_TEST_SCOPE } from "../../../tools/experiments/mutationScope";

/**
 * Pins experiment E10's declared scope against the repository's real import
 * graph.
 *
 * E10 reports a mutation score over the receipt trust kernel. A mutation score
 * is a proportion, so under this repository's empirical rules it may not be
 * reported without its denominator — and a mutation score has two denominators
 * that drift in opposite directions:
 *
 *   - Drop a kernel file from `kernelFiles` and the score rises, because the
 *     hardest-to-kill code stops being counted.
 *   - Drop a covering test from `testFiles` and the score falls, because a
 *     mutant that would have been killed now survives.
 *
 * Neither drift is visible in the number itself. These tests make both visible
 * by recomputing the closure from source every run.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Extension order used to resolve a specifier that omits its extension. */
const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", "/index.ts", "/index.tsx", "/index.js"];

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

function toPosix(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

/**
 * Resolves a relative import specifier to a repo-relative file path.
 *
 * Bare specifiers (`vitest`, `node:crypto`, `@aws-sdk/...`) resolve to null:
 * they are package boundaries, and the kernel is defined by in-repo files.
 * Workspace-internal packages are reached through relative paths in this
 * repository, so this does not silently truncate the closure — the
 * `reaches every kernel file` assertion below would fail if it did.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate) !== undefined) {
          return candidate;
        }
      } catch {
        // Directory or unreadable entry: keep trying suffixes.
      }
    }
  }
  return null;
}

function directImports(absoluteFile: string): string[] {
  let source: string;
  try {
    source = readFileSync(absoluteFile, "utf8");
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) {
      continue;
    }
    const resolved = resolveSpecifier(absoluteFile, specifier);
    if (resolved) {
      found.push(resolved);
    }
  }
  return found;
}

/** Transitive in-repo import closure of a single entry file. */
function importClosure(entryAbsolute: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entryAbsolute];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    queue.push(...directImports(current));
  }
  return seen;
}

const kernelAbsolute = MUTATION_TEST_SCOPE.kernelFiles.map((file) => path.join(REPO_ROOT, file));
const kernelSet = new Set(kernelAbsolute.map((file) => toPosix(file)));

/**
 * Every `.test.ts` vitest would collect under the default config. Kept in sync
 * with `vitest.config.ts`'s include list; a new test directory that the default
 * config picks up but this glob does not would make `coveringTests` too small
 * and is caught by the drift assertion.
 */
function allTestFiles(): string[] {
  const roots = ["tests", "infra/cdk/test", "packages"];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = require("node:fs").readdirSync(dir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  };
  for (const root of roots) {
    walk(path.join(REPO_ROOT, root));
  }
  return out.sort();
}

/** Test files that transitively import at least one kernel file. */
function coveringTests(): string[] {
  return allTestFiles()
    .filter((testFile) => {
      for (const imported of importClosure(testFile)) {
        if (kernelSet.has(toPosix(imported))) {
          return true;
        }
      }
      return false;
    })
    .map(toPosix)
    .sort();
}

describe("E10 mutation scope pre-registration", () => {
  it("names only kernel files that exist", () => {
    for (const file of MUTATION_TEST_SCOPE.kernelFiles) {
      expect(existsSync(path.join(REPO_ROOT, file)), `missing kernel file ${file}`).toBe(true);
    }
  });

  it("names only test files that exist", () => {
    for (const file of MUTATION_TEST_SCOPE.testFiles) {
      expect(existsSync(path.join(REPO_ROOT, file)), `missing test file ${file}`).toBe(true);
    }
  });

  it("declares exactly the tests that transitively import the kernel", () => {
    // The load-bearing assertion. Equality in BOTH directions:
    //   - a covering test missing from the declaration would depress the score
    //     by withholding a killer Stryker was entitled to run;
    //   - a declared test that does not reach the kernel is padding, and pads
    //     Stryker's per-mutant cost without ever killing anything.
    expect([...MUTATION_TEST_SCOPE.testFiles].sort()).toEqual(coveringTests());
  });

  it("gives every kernel file at least one covering test", () => {
    // A kernel file with zero covering tests scores 0% and is a coverage hole,
    // not a mutation-testing result. Surface it as a coverage failure here
    // rather than letting it silently drag the aggregate score down.
    const covered = new Set<string>();
    for (const testFile of MUTATION_TEST_SCOPE.testFiles) {
      for (const imported of importClosure(path.join(REPO_ROOT, testFile))) {
        const rel = toPosix(imported);
        if (kernelSet.has(rel)) {
          covered.add(rel);
        }
      }
    }
    expect([...covered].sort()).toEqual([...MUTATION_TEST_SCOPE.kernelFiles].sort());
  });

  it("keeps stryker.config.json's mutate list identical to the declared kernel", () => {
    // Stryker reads its own config, not this module. Without this assertion the
    // pre-registration and the thing actually measured could disagree, which is
    // precisely the E4 defect (a harness that measures something other than what
    // it reports) applied to E10.
    const config = JSON.parse(readFileSync(path.join(REPO_ROOT, "stryker.config.json"), "utf8")) as {
      mutate: string[];
      vitest?: { configFile?: string };
      thresholds?: { break?: number | null };
    };
    expect([...config.mutate].sort()).toEqual([...MUTATION_TEST_SCOPE.kernelFiles].sort());
    expect(config.vitest?.configFile).toBe("vitest.mutation.config.ts");
  });

  it("keeps a non-null break threshold so the score is gated, not merely reported", () => {
    const config = JSON.parse(readFileSync(path.join(REPO_ROOT, "stryker.config.json"), "utf8")) as {
      thresholds?: { break?: number | null };
    };
    // `break: null` means Stryker always exits 0. A reported-but-ungated score
    // is a number in a README, not a gate, and this repository already carries
    // one documented instance of a threshold that was declared rather than met.
    expect(typeof config.thresholds?.break).toBe("number");
  });

  it("pins the kernel file set by digest so an unreviewed edit is visible", () => {
    const digest = createHash("sha256")
      .update([...MUTATION_TEST_SCOPE.kernelFiles].sort().join("\n"))
      .digest("hex")
      .slice(0, 16);
    // Changing the kernel set is allowed; changing it silently is not. Update
    // this digest in the same commit that changes the set, and say why in the
    // message.
    expect(digest).toBe("a5e4843aa6b76a2a");
  });
});
