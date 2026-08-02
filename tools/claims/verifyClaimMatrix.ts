/**
 * Executes the claim/evidence matrix instead of merely publishing it.
 *
 * THE DEFECT THIS ADDRESSES
 *
 * `docs/governance/claim-evidence-matrix.md` maps 20 public claims to the command
 * that verifies each. That matrix is the repository's answer to "do not trust the
 * author, run the commands" — and until now nothing ran them. A row could name a
 * script that had been renamed, a test file that had been deleted, or a command
 * that exits non-zero, and the matrix would still read as evidence. A documented
 * command nobody executes is an assertion wearing a command's clothes.
 *
 * This tool extracts the `Local command` column, runs each distinct command once,
 * and reports which claims are currently backed by a passing command. It does not
 * decide whether a claim is TRUE — a passing command means the evidence the
 * matrix points at still exists and still succeeds, which is a narrower and
 * checkable thing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not run AWS-required rows. Those are marked `AWS-required` precisely
 * because no local command can establish them, and inventing one would convert a
 * declared gap into a false pass — the failure mode this repository documents
 * more than any other.
 *
 * NON-CLAIM: a green run here means every local command named by the matrix
 * executed successfully on the recorded host and date. It is not evidence that
 * the claims are true, that the commands test what their rows say they test, or
 * that the matrix is complete. A command can pass and still measure nothing —
 * that is what experiment E4 exists to catch, and it is not what this checks.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { resolve } from "node:path";

export const CLAIM_MATRIX_REPORT_VERSION = "ghost.claim_matrix_run.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const MATRIX_PATH = resolve(REPO_ROOT, "docs/governance/claim-evidence-matrix.md");

export interface ClaimRow {
  id: string;
  claim: string;
  command: string | null;
  awsRequired: string;
  status: string;
}

/** Statuses whose evidence is, by declaration, not obtainable locally. */
const NOT_LOCALLY_VERIFIABLE = new Set(["AWS-required", "Not implemented"]);

/** Extracts a runnable command from the matrix cell, or null if there is none. */
export function commandFrom(cell: string): string | null {
  const backticked = /`([^`]+)`/u.exec(cell);
  if (!backticked) {
    // Cells like "Documentation inspection only" are honest non-commands.
    return null;
  }
  const command = backticked[1] as string;
  // Rows annotate some commands as partial: "`npm run spine:c:local` (local
  // preparation only)". The command still runs; the annotation bounds the claim,
  // not the execution.
  return command.trim();
}

export function parseClaimMatrix(markdown: string = readFileSync(MATRIX_PATH, "utf8")): ClaimRow[] {
  return markdown
    .split("\n")
    .filter((line) => /^\|\s*CLAIM-\d+\s*\|/u.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        id: cells[1] as string,
        claim: cells[2] as string,
        command: commandFrom(cells[6] as string),
        awsRequired: cells[7] as string,
        status: cells[8] as string
      };
    });
}

export interface CommandResult {
  command: string;
  claimIds: string[];
  ok: boolean;
  exitCode: number;
  durationMs: number;
  detail: string;
}

export interface ClaimMatrixReport {
  schema_version: typeof CLAIM_MATRIX_REPORT_VERSION;
  verified_at: string;
  host: { platform: string; arch: string; cpu: string; node: string };
  total_claims: number;
  locally_verifiable: number;
  skipped_by_declaration: { id: string; status: string }[];
  results: CommandResult[];
  passed: number;
  failed: number;
  non_claim: string;
}

const NON_CLAIM =
  "A green run means every local command named by the claim matrix executed successfully on the recorded host and " +
  "date. It is NOT evidence that the claims are true, that each command tests what its row says it tests, or that " +
  "the matrix is complete. A command can pass and measure nothing; detecting that is experiment E4's job, not this " +
  "tool's.";

/**
 * Runs each distinct command once, attributing it to every claim that cites it.
 *
 * Deduplicated because five rows cite `npm test`, and running the full suite five
 * times would turn a freshness check into a coffee break — which is how checks
 * stop being run.
 */
export function runClaimMatrix(rows: ClaimRow[] = parseClaimMatrix(), timestamp = new Date().toISOString()): ClaimMatrixReport {
  const byCommand = new Map<string, string[]>();
  const skipped: { id: string; status: string }[] = [];

  for (const row of rows) {
    if (NOT_LOCALLY_VERIFIABLE.has(row.status) || !row.command) {
      skipped.push({ id: row.id, status: row.command ? row.status : `${row.status} (no command)` });
      continue;
    }
    byCommand.set(row.command, [...(byCommand.get(row.command) ?? []), row.id]);
  }

  const results: CommandResult[] = [];
  for (const [command, claimIds] of byCommand) {
    const started = Date.now();
    try {
      execSync(command, { cwd: REPO_ROOT, stdio: "pipe", timeout: 900_000, encoding: "utf8" });
      results.push({ command, claimIds, ok: true, exitCode: 0, durationMs: Date.now() - started, detail: "exit 0" });
    } catch (error) {
      const failure = error as { status?: number; stderr?: Buffer | string; message?: string };
      const stderr = typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString() ?? "";
      results.push({
        command,
        claimIds,
        ok: false,
        exitCode: failure.status ?? -1,
        durationMs: Date.now() - started,
        detail: (stderr || failure.message || "").split("\n").slice(-4).join(" ").slice(0, 300)
      });
    }
  }

  const cpuList = cpus();
  return {
    schema_version: CLAIM_MATRIX_REPORT_VERSION,
    verified_at: timestamp,
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpuList[0]?.model ?? "unknown",
      node: process.version
    },
    total_claims: rows.length,
    locally_verifiable: byCommand.size,
    skipped_by_declaration: skipped,
    results,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    non_claim: NON_CLAIM
  };
}

/** Static check: does each cited command plausibly exist? Cheap, no execution. */
export function unresolvableCommands(rows: ClaimRow[] = parseClaimMatrix()): string[] {
  const scripts = Object.keys(
    (JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts
  );
  const bad: string[] = [];

  for (const row of rows) {
    if (!row.command) {
      continue;
    }
    const npmRun = /^npm run ([\w:-]+)/u.exec(row.command);
    if (npmRun && !scripts.includes(npmRun[1] as string)) {
      bad.push(`${row.id}: npm script "${npmRun[1]}" does not exist`);
      continue;
    }
    // Every test path the command names must exist, or the row cites a file that
    // was renamed or deleted and nobody noticed.
    for (const path of row.command.match(/tests\/[\w./-]+\.test\.ts/gu) ?? []) {
      if (!existsSync(resolve(REPO_ROOT, path))) {
        bad.push(`${row.id}: test file "${path}" does not exist`);
      }
    }
  }
  return bad;
}

/** CLI: `npm run claims:verify [-- --json] [-- --static]` */
function main(): void {
  const rows = parseClaimMatrix();

  if (process.argv.includes("--static")) {
    const bad = unresolvableCommands(rows);
    process.stdout.write(
      bad.length === 0
        ? `claim matrix: ${rows.length} claims, every cited command resolves\n`
        : `claim matrix: ${bad.length} unresolvable command(s)\n${bad.map((b) => `  - ${b}`).join("\n")}\n`
    );
    process.exitCode = bad.length === 0 ? 0 : 1;
    return;
  }

  const report = runClaimMatrix(rows);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines: string[] = [];
    lines.push(`claim matrix execution (${report.schema_version})`);
    lines.push(`verified_at: ${report.verified_at}`);
    lines.push(`host: ${report.host.platform}/${report.host.arch}, ${report.host.cpu}, node ${report.host.node}`);
    lines.push(
      `${report.total_claims} claims | ${report.locally_verifiable} distinct local commands | ` +
        `${report.skipped_by_declaration.length} skipped by declaration`
    );
    lines.push("");
    for (const result of report.results) {
      lines.push(
        `${result.ok ? "PASS" : "FAIL"}  ${(result.durationMs / 1000).toFixed(1)}s  ` +
          `[${result.claimIds.join(", ")}]  ${result.command.slice(0, 72)}`
      );
      if (!result.ok) {
        lines.push(`        ${result.detail}`);
      }
    }
    lines.push("");
    lines.push("skipped because the matrix declares them not locally verifiable:");
    for (const skip of report.skipped_by_declaration) {
      lines.push(`  ${skip.id} — ${skip.status}`);
    }
    lines.push("");
    lines.push(`passed ${report.passed} | failed ${report.failed}`);
    lines.push("");
    lines.push(`NON-CLAIM: ${report.non_claim}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  process.exitCode = report.failed === 0 ? 0 : 1;
}

if (require.main === module) {
  main();
}
