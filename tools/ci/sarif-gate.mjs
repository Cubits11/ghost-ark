#!/usr/bin/env node
// Gate a CI job on a SARIF report, and publish the finding histogram to the job
// summary so the count is visible without repository credentials.
//
// WHY THIS EXISTS RATHER THAN `--error` ON EACH SCANNER
//
// Two reasons, both measured rather than assumed.
//
// 1. UPLOAD BEFORE GATE. When a scanner exits non-zero on findings, the SARIF
//    upload step is skipped and the findings never reach the Security tab —
//    precisely when they are wanted. Every scanner here is therefore run with
//    its failure exit disabled, uploaded, and then gated by this script.
//
// 2. NEITHER SCANNER PUTS `level` ON A RESULT, AND THEY DIFFER IN WHY.
//    Both were measured rather than assumed, and both contradicted the obvious
//    implementation:
//      - semgrep 1.172.0 emits `result.level: undefined` and carries the
//        severity on `tool.driver.rules[].defaultConfiguration.level`
//        ("error" / "warning"). Hence the ruleDefaults fallback below.
//      - gitleaks 8.30.1 emits NO level anywhere: not on the result, and no
//        `defaultConfiguration` on its rules. Verified against this
//        repository's own history, where the one true finding — a live-format
//        API key — came back completely unlevelled.
//    A gate written the obvious way, `results.filter(r => r.level === "error")`,
//    therefore scores ZERO for both scanners no matter what they found. It would
//    have passed while a real key sat in the history. That is the
//    tautological-detector defect this repository quarantined dab/bench for, and
//    it is why the "error-only" policy refuses to run when no result carries a
//    level from either source.
//
// Usage: node tools/ci/sarif-gate.mjs <report.sarif> <label> <any|error-only>

import { appendFileSync, readFileSync, existsSync } from "node:fs";

const [reportPath, label, policy] = process.argv.slice(2);

if (!reportPath || !label || !policy) {
  console.error("usage: sarif-gate.mjs <report.sarif> <label> <any|error-only>");
  process.exit(2);
}
if (policy !== "any" && policy !== "error-only") {
  console.error(`unknown policy ${JSON.stringify(policy)}; expected "any" or "error-only"`);
  process.exit(2);
}

// A missing or empty report is a FAILED scan, not a clean one. Treating absence
// as success is how a broken scanner becomes a green badge.
if (!existsSync(reportPath)) {
  console.error(`${label}: ${reportPath} does not exist — the scan did not produce a report.`);
  console.error("Treating a missing report as a failed scan rather than as zero findings.");
  process.exit(1);
}

let sarif;
try {
  const raw = readFileSync(reportPath, "utf8");
  if (raw.trim().length === 0) {
    throw new Error("report is empty");
  }
  sarif = JSON.parse(raw);
} catch (error) {
  console.error(`${label}: could not parse ${reportPath}: ${error.message}`);
  process.exit(1);
}

const results = (sarif.runs ?? []).flatMap((run) => run.results ?? []);

/** Rule-level severity, used only when a result omits its own `level`. */
const ruleDefaults = new Map();
for (const run of sarif.runs ?? []) {
  for (const rule of run.tool?.driver?.rules ?? []) {
    const level = rule.defaultConfiguration?.level;
    if (rule.id && level) {
      ruleDefaults.set(rule.id, level);
    }
  }
}

const levelOf = (result) => result.level ?? ruleDefaults.get(result.ruleId) ?? null;

const histogram = new Map();
const byRule = new Map();
for (const result of results) {
  const level = levelOf(result) ?? "(no level reported)";
  histogram.set(level, (histogram.get(level) ?? 0) + 1);
  const key = result.ruleId ?? "(no ruleId)";
  byRule.set(key, (byRule.get(key) ?? 0) + 1);
}

const summary = [
  `### ${label}: ${results.length} finding${results.length === 1 ? "" : "s"}`,
  "",
  `Gate policy: \`${policy}\`.`,
  ""
];

if (results.length > 0) {
  summary.push("| severity | count |", "|:--|--:|");
  for (const [level, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
    summary.push(`| ${level} | ${count} |`);
  }
  summary.push("", "| rule | count |", "|:--|--:|");
  for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    summary.push(`| \`${rule}\` | ${count} |`);
  }
  if (byRule.size > 15) {
    summary.push(`| _…and ${byRule.size - 15} more rules_ | |`);
  }
  summary.push("", "Full detail is in the Security tab under this run's SARIF upload.");
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  appendFileSync(summaryPath, `${summary.join("\n")}\n\n`);
}
console.log(summary.join("\n"));

if (policy === "any") {
  if (results.length > 0) {
    console.error(`\n${label}: FAIL — ${results.length} finding(s), and this gate admits none.`);
    process.exit(1);
  }
  console.log(`\n${label}: pass — no findings.`);
  process.exit(0);
}

// policy === "error-only"
//
// Guard against the severity field disappearing. If findings exist but not one
// of them carries a level, this gate cannot distinguish "nothing serious" from
// "severity was never reported", and the safe reading is the second.
const levelled = results.filter((result) => levelOf(result) !== null);
if (results.length > 0 && levelled.length === 0) {
  console.error(
    `\n${label}: FAIL — ${results.length} finding(s), none carrying a SARIF \`level\`.`
  );
  console.error(
    "An error-only gate over unlevelled findings always passes, which would make this"
  );
  console.error(
    "job report clean while the scanner reported findings. Fix the scanner's severity"
  );
  console.error('output, or move this job to the "any" policy.');
  process.exit(1);
}

const errors = results.filter((result) => levelOf(result) === "error");
if (errors.length > 0) {
  console.error(`\n${label}: FAIL — ${errors.length} finding(s) at level "error".`);
  for (const error of errors.slice(0, 20)) {
    const where = error.locations?.[0]?.physicalLocation;
    const uri = where?.artifactLocation?.uri ?? "(no file)";
    const line = where?.region?.startLine ?? "?";
    console.error(`  ${error.ruleId ?? "(no ruleId)"} — ${uri}:${line}`);
  }
  process.exit(1);
}

console.log(
  `\n${label}: pass — 0 findings at level "error" (${results.length - errors.length} at lower severities, not gated).`
);
