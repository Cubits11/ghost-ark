#!/usr/bin/env node

/**
 * Ghost-Ark receipt-verifier conformance harness.
 *
 * Runs a candidate verifier — ANY executable honouring the adapter contract in
 * conformance.json — over every case and scores three levels:
 *
 *   verdict        exit code agrees with the expected verdict     (required)
 *   failing-check  the declared failing check is among the failed (if the
 *                  candidate emits a JSON `checks` array)
 *   identity       recomputed receipt_id / digest agree           (if the
 *                  candidate emits a JSON `recomputed` object)
 *
 * This file imports Node.js built-ins only and nothing from Ghost-Ark. It can
 * be copied out of this repository together with SPEC.md, conformance.json and
 * fixtures/ and used with no other Ghost-Ark code, which is the point: it
 * exists so that a verifier implemented by SOMEBODY ELSE, from SPEC.md alone,
 * can be checked without trusting or reading this project's verifiers.
 *
 * Usage:
 *   node run-conformance.mjs [--json] [--manifest <conformance.json>] -- <candidate command...>
 *
 * Examples:
 *   node run-conformance.mjs -- python3 my_verifier.py
 *   node run-conformance.mjs --json -- node ../verifiers/node/ghost_receipt_verify.mjs
 *
 * Exit code 0 iff verdict conformance is total AND no evaluated failing-check
 * or identity comparison mismatches. Levels that were not evaluated (because
 * the candidate emits no machine-readable report) are reported as
 * `not-evaluated`, never as passed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1 || separator === argv.length - 1) {
    throw new TypeError(
      "No candidate command supplied. Usage: node run-conformance.mjs [--json] [--manifest <path>] -- <command...>"
    );
  }
  const own = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const options = { json: false, manifest: join(HERE, "conformance.json"), command };
  for (let index = 0; index < own.length; index += 1) {
    if (own[index] === "--json") {
      options.json = true;
    } else if (own[index] === "--manifest") {
      options.manifest = resolve(own[index + 1] ?? "");
      index += 1;
    } else {
      throw new TypeError(`Unknown argument: ${own[index]}`);
    }
  }
  return options;
}

/** Extract the candidate's JSON report from stdout, tolerating leading or
 * trailing non-JSON lines but never guessing: the first `{` to the last `}`
 * must parse, or the report is treated as absent. */
function extractReport(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function failedCheckNames(report) {
  if (!report || !Array.isArray(report.checks)) {
    return null;
  }
  const named = report.checks.filter(
    (entry) => entry !== null && typeof entry === "object" && typeof entry.name === "string"
  );
  if (named.length === 0) {
    return null;
  }
  return named.filter((entry) => entry.passed !== true).map((entry) => entry.name);
}

export function runSuite(manifestPath, command) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema_version !== "ghost.receipt_conformance.v1") {
    throw new TypeError(`Unsupported conformance manifest schema: ${manifest.schema_version}`);
  }
  const baseDir = dirname(resolve(manifestPath));

  // Refuse rather than degrade: a missing fixture would silently shrink the
  // suite, and a shrunken suite changes the answer, not just its coverage.
  for (const testCase of manifest.cases) {
    for (let index = 0; index < testCase.args.length; index += 1) {
      if (testCase.args[index] === "--receipt" || testCase.args[index] === "--key") {
        const path = join(baseDir, testCase.args[index + 1]);
        if (!existsSync(path)) {
          throw new Error(`fixture missing for case ${testCase.case_id}: ${path}`);
        }
      }
    }
  }

  const results = [];
  for (const testCase of manifest.cases) {
    const args = testCase.args.map((argument, index) => {
      const previous = testCase.args[index - 1];
      return (previous === "--receipt" || previous === "--key") && !isAbsolute(argument)
        ? join(baseDir, argument)
        : argument;
    });
    const spawned = spawnSync(command[0], [...command.slice(1), ...args], {
      encoding: "utf8",
      timeout: 60_000
    });
    if (spawned.error) {
      throw new Error(`candidate could not be executed on ${testCase.case_id}: ${spawned.error.message}`);
    }

    const observedVerdict = spawned.status === 0 ? "PASS" : "FAIL";
    const report = extractReport(spawned.stdout ?? "");
    const failed = failedCheckNames(report);

    const verdictOk = observedVerdict === testCase.expected_verdict;

    let failingCheck = "not-evaluated";
    if (testCase.expected_verdict === "FAIL" && Array.isArray(testCase.expected_failing_checks)) {
      if (failed !== null) {
        failingCheck = testCase.expected_failing_checks.some((name) => failed.includes(name))
          ? "match"
          : "mismatch";
      }
    } else if (testCase.expected_verdict === "PASS") {
      failingCheck = "not-applicable";
    }

    let identity = "not-evaluated";
    if (testCase.expected_recomputed) {
      const recomputed = report?.recomputed;
      if (recomputed && typeof recomputed === "object") {
        identity =
          recomputed.receipt_id === testCase.expected_recomputed.receipt_id &&
          recomputed.digest_sha256 === testCase.expected_recomputed.digest_sha256
            ? "match"
            : "mismatch";
      }
    } else {
      identity = "not-applicable";
    }

    results.push({
      case_id: testCase.case_id,
      expected_verdict: testCase.expected_verdict,
      observed_verdict: observedVerdict,
      verdict_ok: verdictOk,
      expected_failing_checks: testCase.expected_failing_checks ?? null,
      observed_failed_checks: failed,
      failing_check: failingCheck,
      identity
    });
  }

  const verdictMismatches = results.filter((entry) => !entry.verdict_ok);
  const checkMismatches = results.filter((entry) => entry.failing_check === "mismatch");
  const identityMismatches = results.filter((entry) => entry.identity === "mismatch");
  const checkEvaluated = results.filter(
    (entry) => entry.failing_check === "match" || entry.failing_check === "mismatch"
  );
  const identityEvaluated = results.filter(
    (entry) => entry.identity === "match" || entry.identity === "mismatch"
  );

  return {
    schema_version: "ghost.receipt_conformance_report.v1",
    suite_version: manifest.suite_version,
    candidate: command.join(" "),
    totals: {
      cases: results.length,
      verdict_conformant: results.length - verdictMismatches.length,
      verdict_mismatches: verdictMismatches.length,
      failing_check_evaluated: checkEvaluated.length,
      failing_check_mismatches: checkMismatches.length,
      identity_evaluated: identityEvaluated.length,
      identity_mismatches: identityMismatches.length
    },
    conformant:
      verdictMismatches.length === 0 && checkMismatches.length === 0 && identityMismatches.length === 0,
    results,
    non_claim: manifest.non_claim
  };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  let report;
  try {
    report = runSuite(options.manifest, options.command);
  } catch (error) {
    console.error(`conformance harness error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`receipt-conformance ${report.suite_version} — candidate: ${report.candidate}`);
    console.log(
      `  verdict:       ${report.totals.verdict_conformant}/${report.totals.cases} conformant`
    );
    console.log(
      `  failing-check: ${
        report.totals.failing_check_evaluated === 0
          ? "not evaluated (candidate emits no machine-readable checks)"
          : `${report.totals.failing_check_evaluated - report.totals.failing_check_mismatches}/${report.totals.failing_check_evaluated} evaluated comparisons match`
      }`
    );
    console.log(
      `  identity:      ${
        report.totals.identity_evaluated === 0
          ? "not evaluated (candidate emits no recomputed identities)"
          : `${report.totals.identity_evaluated - report.totals.identity_mismatches}/${report.totals.identity_evaluated} evaluated comparisons match`
      }`
    );
    for (const entry of report.results) {
      if (!entry.verdict_ok) {
        console.log(
          `  VERDICT MISMATCH ${entry.case_id}: expected ${entry.expected_verdict}, observed ${entry.observed_verdict}`
        );
      }
      if (entry.failing_check === "mismatch") {
        console.log(
          `  CHECK MISMATCH   ${entry.case_id}: expected one of [${entry.expected_failing_checks.join(", ")}] to fail; observed failed: [${(entry.observed_failed_checks ?? []).join(", ")}]`
        );
      }
      if (entry.identity === "mismatch") {
        console.log(`  IDENTITY MISMATCH ${entry.case_id}`);
      }
    }
    console.log(`  conformant: ${report.conformant ? "yes" : "NO"}`);
    console.log(`  non-claim: ${report.non_claim}`);
  }
  return report.conformant ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
