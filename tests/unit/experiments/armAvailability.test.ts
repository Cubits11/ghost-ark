import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression tests for a defect in E1's own measurement infrastructure.
 *
 * WHAT WAS WRONG
 *
 * `runPythonArm` reported a missing interpreter as `rejected("python3
 * unavailable: ...")` — the same channel CPython uses to say "I refuse this
 * input". The consequences compounded:
 *
 *   1. Every pathology became a `rejected-both` cell, so the python arm scored
 *      `fail-closed` on all 31 classes.
 *   2. A uniformly fail-closed arm produces no `collapsed`/`distinct` cells, so
 *      it stops being a *deciding* arm and drops out of the unanimity test
 *      behind `universal_unintended_kernel`.
 *   3. That count therefore moved from 4 (python present) to 5 (python absent),
 *      with exit code 0 and one annotation line in the report.
 *
 * A number that changes with ambient environment while the run still reports
 * success is the E4 defect — a harness that reports a good result when the
 * mechanism it depends on is broken — living inside the experiment
 * infrastructure E4 exists to police.
 *
 * Separately, a `python3` spawn that exceeded its timeout under parallel load
 * threw `ETIMEDOUT` straight out of the census, making the suite
 * nondeterministically red. Same class as the CDK-synth flake in AGENTS.md.
 *
 * WHY THIS TEST SHELLS OUT
 *
 * The defect is about process environment, and `probePython` caches its result
 * per process. Mutating PATH inside the vitest worker would either poison other
 * tests in the same worker or measure the cache rather than the behavior. A
 * child process with a shadowed `python3` on PATH is the only way to observe
 * the real code path, so this test pays the subprocess cost deliberately.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Builds a PATH whose `python3` exits non-zero, shadowing any real interpreter. */
function pathWithBrokenPython(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ghost-ark-e1-nopython-"));
  const shim = path.join(dir, "python3");
  writeFileSync(shim, "#!/bin/sh\nexit 127\n");
  chmodSync(shim, 0o755);
  return `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
}

interface CensusRun {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the census in a child process with a broken `python3`.
 *
 * `allowDegraded` selects which of the two supported behaviors is exercised.
 */
function runCensusWithoutPython(allowDegraded: boolean): CensusRun {
  const program = [
    "const { runE1Census } = require('./tools/experiments/e1KernelCensus.ts');",
    `runE1Census(undefined, { allowDegradedArms: ${String(allowDegraded)} })`,
    "  .then((report) => { process.stdout.write(JSON.stringify({",
    "    degraded: report.degraded,",
    "    excluded: report.excluded_arms.map((a) => a.armId),",
    "    universal: report.universal_unintended_kernel.length,",
    "    armIds: report.arms.map((a) => a.armId)",
    "  })); })",
    "  .catch((error) => { process.stderr.write(String(error && error.message)); process.exit(3); });"
  ].join("\n");

  try {
    const stdout = execFileSync(
      process.execPath,
      ["--require", "ts-node/register", "-e", program],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 180_000,
        env: { ...process.env, PATH: pathWithBrokenPython(), TS_NODE_TRANSPILE_ONLY: "true" }
      }
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

describe("E1 arm availability is not silently folded into verdicts", () => {
  it("refuses to emit a census when a declared arm cannot be executed", () => {
    const run = runCensusWithoutPython(false);

    // The load-bearing assertion: absence of evidence must not exit 0 with a
    // plausible-looking number attached.
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("could not be executed");
    expect(run.stderr).toContain("python-json-sorted");
    // The message must say WHY refusing is the right response, not just that it
    // refused, or the next maintainer will "fix" it by passing the flag.
    expect(run.stderr).toContain("changes universal_unintended_kernel");
  }, 200_000);

  it("stamps an explicitly-requested degraded run and drops the arm rather than scoring it", () => {
    const run = runCensusWithoutPython(true);

    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout) as {
      degraded: boolean;
      excluded: string[];
      universal: number;
      armIds: string[];
    };

    expect(report.degraded).toBe(true);
    expect(report.excluded).toContain("python-json-sorted");

    // The arm must be ABSENT, not present-and-fail-closed. A present arm with 31
    // fail-closed cells is what produced the silent 4 -> 5 shift: it looks like a
    // measured result and is not one.
    expect(report.armIds).not.toContain("python-json-sorted");
  }, 200_000);
});
