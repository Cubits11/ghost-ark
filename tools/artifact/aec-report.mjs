#!/usr/bin/env node
/**
 * Ghost-Ark — Artifact Evaluation Committee (AEC) report generator.
 *
 * Aggregates per-stage status files (artifacts/status/*.json, written by
 * scripts/reproduce.sh) plus the detailed stage artifacts (proofs, attacks,
 * benchmarks) into a single machine-readable and human-readable report:
 *
 *   artifacts/reports/aec_summary.json
 *   artifacts/reports/aec_summary.md
 *
 * It reports the repository's ACTUAL state. The overall status is PASS only if
 * every gating stage passed. There is no override that manufactures a green
 * result. Exits 0 iff overall status is PASS.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATUS_DIR = join(ROOT, "artifacts", "status");
const REPORT_DIR = join(ROOT, "artifacts", "reports");
mkdirSync(REPORT_DIR, { recursive: true });

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function collectStages() {
  if (!existsSync(STATUS_DIR)) return [];
  return readdirSync(STATUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(STATUS_DIR, f)))
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

const commit = tryExec("git rev-parse HEAD") ?? "unknown";
const commitShort = commit.slice(0, 12);
const dirty = (tryExec("git status --porcelain") ?? "").length > 0;
const timestamp = new Date().toISOString();

const versions = {
  node: process.version,
  npm: tryExec("npm --version"),
  java: (tryExec("java -version 2>&1") ?? "").split("\n")[0] || null,
  pandoc: tryExec("pandoc --version")?.split("\n")[0] ?? null,
  latexmk: tryExec("latexmk -v")?.split("\n")[0] ?? null,
  cargo: tryExec("cargo --version") ?? null,
};

const stages = collectStages();

// ---- Detailed stage artifacts -------------------------------------------------
const proofs = readJson(join(ROOT, "artifacts", "proofs", "proofs_summary.json"));
const attacks = readJson(join(ROOT, "artifacts", "attacks", "attacks_summary.json"));
const benchmarks = readJson(join(ROOT, "artifacts", "benchmarks", "benchmarks_summary.json"));

// Proof roll-up
let proofRollup = { gating_total: 0, gating_met: 0, quarantined: 0, stub: 0, results: [] };
if (proofs?.results) {
  for (const r of proofs.results) {
    if (r.quarantined) proofRollup.quarantined += 1;
    else if (r.gating === false) proofRollup.stub += 1;
    else {
      proofRollup.gating_total += 1;
      if (r.met) proofRollup.gating_met += 1;
    }
  }
  proofRollup.results = proofs.results.map((r) => ({
    module: r.module,
    expect: r.expect,
    status: r.status,
    met: r.met,
    distinct_states: r.distinct_states ?? null,
    quarantined: Boolean(r.quarantined),
  }));
}

// Tests roll-up (parsed from the unit stage detail, if present)
const unitStage = stages.find((s) => s.stage === "unit");
let tests = { passed: null, failed: null, skipped: null, total: null };
if (unitStage?.detail) {
  const m = unitStage.detail.match(/(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);
  if (m) {
    tests = {
      failed: m[1] ? Number(m[1]) : 0,
      passed: Number(m[2]),
      skipped: m[3] ? Number(m[3]) : 0,
      total: Number(m[4]),
    };
  }
}

// ---- Overall status -----------------------------------------------------------
const gatingStages = stages.filter((s) => s.gating !== false);
const gatingFailures = gatingStages.filter((s) => s.exit !== 0).map((s) => s.stage);
const overall = gatingFailures.length === 0 && gatingStages.length > 0 ? "PASS" : "FAIL";
const totalSeconds = stages.reduce((acc, s) => acc + (s.seconds ?? 0), 0);

const attacksBlockedNote = attacks
  ? `root_security=${attacks.root_security?.passed}; dab_bench.all_passed=${attacks.dab_bench?.all_passed} (global_advantage=${attacks.dab_bench?.global_advantage})`
  : "not run";

const summary = {
  artifact: "Ghost-Ark",
  repository: tryExec("git config --get remote.origin.url") ?? "local",
  commit,
  commit_dirty: dirty,
  timestamp,
  platform: `${os.type()} ${os.release()}`,
  arch: os.arch(),
  cpus: os.cpus()?.length ?? null,
  hostname: os.hostname(),
  versions,
  runtime_seconds: totalSeconds,
  stages: stages.map((s) => ({
    stage: s.stage,
    label: s.label ?? s.stage,
    exit: s.exit,
    status: s.exit === 0 ? "PASS" : "FAIL",
    gating: s.gating !== false,
    seconds: s.seconds ?? null,
    detail: s.detail ?? null,
  })),
  proofs: proofRollup,
  attacks: attacks ?? null,
  benchmarks: benchmarks ?? null,
  tests,
  gating_failures: gatingFailures,
  status: overall,
  claim_boundary:
    "Ghost-Ark verifies recorded, signed, policy-bounded, replayable bindings under Ghost-Ark verifier rules. It does not prove semantic safety, truth, compliance, alignment, production readiness, or deployment correctness.",
};

writeFileSync(join(REPORT_DIR, "aec_summary.json"), JSON.stringify(summary, null, 2) + "\n");

// ---- Human-readable markdown --------------------------------------------------
const row = (s) =>
  `| ${s.stage} | ${s.exit === 0 ? "PASS" : "FAIL"} | ${s.gating !== false ? "yes" : "no"} | ${s.seconds ?? "-"}s | ${(s.detail ?? "").replace(/\|/g, "/").slice(0, 80)} |`;

const md = `# Ghost-Ark — USENIX Artifact Evaluation Summary

**Overall status: ${overall}**${overall === "FAIL" ? ` (gating failures: ${gatingFailures.join(", ") || "none"})` : ""}

- Repository: ${summary.repository}
- Commit: \`${commitShort}\`${dirty ? " (working tree dirty)" : ""}
- Timestamp: ${timestamp}
- Platform: ${summary.platform} (${summary.arch}, ${summary.cpus} CPUs)
- Node ${versions.node} / npm ${versions.npm} / ${versions.java ?? "no java"}${versions.cargo ? " / " + versions.cargo : " / no cargo"}${versions.pandoc ? " / pandoc" : " / no pandoc"}${versions.latexmk ? "+latexmk" : ""}
- Total measured stage runtime: ${totalSeconds}s

## Stages

| Stage | Status | Gating | Time | Detail |
|-------|--------|--------|------|--------|
${stages.map(row).join("\n") || "| (no stages recorded) | - | - | - | - |"}

## Proofs (TLA+)

- Gating specs met expectation: **${proofRollup.gating_met}/${proofRollup.gating_total}**
- Quarantined (invalid TLA+ at HEAD; see repository_inventory.md 7.1-7.2): **${proofRollup.quarantined}**
- Declared stubs (non-gating): **${proofRollup.stub}**

${
  proofRollup.results.length
    ? "| Module | Expect | Status | Met | States |\n|--------|--------|--------|-----|--------|\n" +
      proofRollup.results
        .map((r) => `| ${r.module}${r.quarantined ? " (quarantined)" : ""} | ${r.expect} | ${r.status} | ${r.met} | ${r.distinct_states ?? "-"} |`)
        .join("\n")
    : "_No proof results recorded._"
}

## Adversarial evidence

${attacksBlockedNote}

> The DAB bench RED state is caused by inverted benchmark accounting, not a
> defense failure. See docs/artifact/repository_inventory.md §7.6.

## Tests

${tests.total !== null ? `${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped (${tests.total} total)` : "_Not parsed._"}

## Benchmarks

${benchmarks ? "```json\n" + JSON.stringify(benchmarks, null, 2) + "\n```" : "_Not run._"}

## Claim boundary

${summary.claim_boundary}

---
_Generated by tools/artifact/aec-report.mjs. This report reflects the repository's
actual state; there is no override that manufactures a green result._
`;

writeFileSync(join(REPORT_DIR, "aec_summary.md"), md);

// ---- Banner -------------------------------------------------------------------
const line = "=".repeat(41);
process.stdout.write(
  [
    line,
    "USENIX SECURITY ARTIFACT REPORT",
    line,
    `Repository:      ${summary.repository}`,
    `Commit:          ${commitShort}${dirty ? " (dirty)" : ""}`,
    `Platform:        ${summary.platform} (${summary.arch})`,
    `Total Tests:     ${tests.total !== null ? `${tests.passed}/${tests.total} passed` : "n/a"}`,
    `Proofs Passed:   ${proofRollup.gating_met}/${proofRollup.gating_total} (gating); ${proofRollup.quarantined} quarantined`,
    `Attacks Blocked: ${attacks ? `root=${attacks.root_security?.passed}, dab=${attacks.dab_bench?.all_passed}` : "n/a"}`,
    `Benchmarks:      ${benchmarks ? `overhead ${benchmarks.overhead_percent ?? "?"}%` : "n/a"}`,
    `Runtime:         ${totalSeconds}s`,
    `Status:          ${overall}`,
    line,
    "",
  ].join("\n"),
);

process.exit(overall === "PASS" ? 0 : 1);
