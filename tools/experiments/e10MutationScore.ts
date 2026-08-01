/**
 * E10 — Mutation score over the receipt trust kernel.
 *
 * The question
 * ------------
 * This repository's defence is that a skeptical reviewer need not trust the
 * author, because the tests can be run. That defence assumes the tests would
 * FAIL if the code were wrong — and nothing in the repository has ever checked
 * that assumption. A suite of 970 passing tests is consistent with a suite that
 * asserts nothing load-bearing.
 *
 * E4 established the discriminator principle for benchmarks: break the
 * mechanism, confirm detection stops. E10 is that principle applied to the test
 * suite itself, at scale and mechanically. Stryker introduces a small semantic
 * change into the trust kernel — flips a comparison, drops a call, replaces a
 * string, negates a condition — and asks whether any test notices.
 *
 *   killed    a test failed. The suite detects that change.
 *   survived  every test still passed. The suite does NOT detect that change.
 *   timeout   the mutant hung; counted as killed, because a hang is a detected
 *             behavioral change (Stryker's convention, kept for comparability).
 *   no cover  no test in scope executes that line at all.
 *
 * Why the surviving mutants are the result and the score is not
 * ------------------------------------------------------------
 * A mutation score is a proportion, and a high one is easy to manufacture by
 * narrowing what is mutated. The score is reported because it is comparable
 * across runs of a PINNED scope, not because it is meaningful on its own.
 * `tools/experiments/mutationScope.ts` pre-registers both the mutated source
 * set and the tests allowed to kill, and `tests/unit/experiments/
 * mutationScope.test.ts` recomputes both from the import graph.
 *
 * The actionable output is the per-file survivor list: each survivor is a
 * concrete edit to the trust kernel that the suite does not catch. Those are
 * enumerated, not summarized away.
 *
 * Why there are no confidence intervals here
 * ------------------------------------------
 * The mutant set is a census, not a sample. Stryker enumerates every mutation
 * its operators can produce over the declared files; it does not draw randomly
 * from a population of possible defects. Under this repository's empirical
 * rules a census gets exact counts and no interval, so `reportProportion` is
 * called with provenance "census" and will refuse to attach one.
 *
 * NON-CLAIM: E10 measures whether the declared test scope detects Stryker's
 * mutation operators applied to the declared source scope, on the host recorded
 * in the report. Mutation operators are a proxy for real defects, not a
 * generator of them: a high score is not evidence of correctness, security,
 * cryptographic soundness, absence of design flaws, or absence of defect classes
 * the operators cannot express. A surviving mutant is a demonstrated gap; a
 * killed mutant is only the absence of that one gap.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { resolve } from "node:path";

import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { MUTATION_TEST_SCOPE } from "./mutationScope";

export const E10_REPORT_SCHEMA_VERSION = "ghost.e10_mutation_score.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const DEFAULT_REPORT = resolve(REPO_ROOT, "artifacts/mutation/report.json");

/** Stryker's per-mutant verdicts, as they appear in its JSON report. */
type MutantStatus =
  | "Killed"
  | "Survived"
  | "NoCoverage"
  | "CompileError"
  | "RuntimeError"
  | "Timeout"
  | "Ignored"
  | "Pending";

interface StrykerMutant {
  id: string;
  mutatorName: string;
  status: MutantStatus;
  location: { start: { line: number; column: number } };
  replacement?: string;
}

interface StrykerReport {
  files: Record<string, { mutants: StrykerMutant[] }>;
}

export interface SurvivingMutant {
  file: string;
  line: number;
  mutator: string;
  replacement: string | null;
}

export interface FileScore {
  file: string;
  /** Mutants that ran and produced a verdict. Excludes compile/runtime errors. */
  evaluated: number;
  killed: number;
  survived: number;
  noCoverage: number;
  /** Non-null only when at least one mutant was evaluated. */
  score: ProportionReport | null;
  /**
   * Number of test files in the declared scope that transitively import this
   * file. A low number next to a low score localizes the gap: too few tests
   * reach it, rather than the tests that reach it being weak.
   */
  coveringTestCount: number | null;
}

export interface E10Report {
  schema_version: typeof E10_REPORT_SCHEMA_VERSION;
  /** Every mutant Stryker's operators can produce: a census, not a sample. */
  sample_provenance: "census";
  host: {
    platform: string;
    arch: string;
    cpu_model: string;
    cpu_count: number;
    total_memory_gb: number;
    node_version: string;
  };
  scope: {
    mutated_files: number;
    test_files_in_scope: number;
  };
  totals: {
    evaluated: number;
    killed: number;
    survived: number;
    noCoverage: number;
    /** Mutants Stryker could not evaluate. Reported, never silently dropped. */
    errored: number;
    ignored: number;
  };
  overall_score: ProportionReport | null;
  per_file: FileScore[];
  /** Every surviving mutant, enumerated. The actionable half of the report. */
  survivors: SurvivingMutant[];
  non_claim: string;
}

const NON_CLAIM =
  "E10 measures whether the declared test scope detects Stryker's mutation operators applied to the declared " +
  "source scope, on the recorded host. Mutation operators are a proxy for defects, not a generator of them. A high " +
  "score is not evidence of correctness, security, cryptographic soundness, or absence of defect classes the " +
  "operators cannot express. A surviving mutant is a demonstrated gap; a killed mutant is only the absence of that gap.";

/**
 * Interval provider for a census, following the E5 pattern: passing a thrower
 * rather than `wilsonInterval` makes it a runtime error if provenance is ever
 * flipped to "sampled" without someone thinking about what the sample is.
 */
const neverCalled = (): { low: number; high: number } => {
  throw new Error("ghost_ark.e10: an interval provider must never be invoked for a census.");
};

function toRepoRelative(file: string): string {
  const absolute = resolve(file);
  const relative = absolute.startsWith(REPO_ROOT) ? absolute.slice(REPO_ROOT.length + 1) : file;
  return relative.split("\\").join("/");
}

/**
 * Counts declared-scope test files that transitively import `kernelFile`.
 *
 * Deliberately shells out to `git grep` on the module basename rather than
 * rebuilding the import resolver that already lives in the scope test. This is
 * an ANNOTATION on the score, not part of it — an imprecise count here changes
 * no verdict, whereas a second copy of the resolver could drift from the one
 * that gates the scope.
 */
function coveringTestCountFor(kernelFile: string): number | null {
  const basename = kernelFile.split("/").pop()?.replace(/\.ts$/, "");
  if (!basename) {
    return null;
  }
  try {
    const output = execSync(`git grep -l -- "${basename}" ${MUTATION_TEST_SCOPE.testFiles.map((f) => `'${f}'`).join(" ")}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    // git grep exits 1 on no match, which is a real answer of zero.
    return 0;
  }
}

export function summarizeStrykerReport(report: StrykerReport): E10Report {
  const perFile: FileScore[] = [];
  const survivors: SurvivingMutant[] = [];

  let totalKilled = 0;
  let totalSurvived = 0;
  let totalNoCoverage = 0;
  let totalErrored = 0;
  let totalIgnored = 0;

  for (const [rawFile, entry] of Object.entries(report.files)) {
    const file = toRepoRelative(rawFile);
    let killed = 0;
    let survived = 0;
    let noCoverage = 0;

    for (const mutant of entry.mutants) {
      switch (mutant.status) {
        case "Killed":
        case "Timeout":
          // A timeout is a detected behavioral change. Stryker counts it as
          // killed and this report follows that convention so the number stays
          // comparable to any other Stryker output.
          killed += 1;
          break;
        case "Survived":
          survived += 1;
          survivors.push({
            file,
            line: mutant.location.start.line,
            mutator: mutant.mutatorName,
            replacement: mutant.replacement ?? null
          });
          break;
        case "NoCoverage":
          noCoverage += 1;
          break;
        case "Ignored":
          totalIgnored += 1;
          break;
        default:
          // CompileError / RuntimeError / Pending. Counted and reported rather
          // than dropped: a mutant that could not be evaluated is missing data,
          // and silently excluding it would quietly shrink the denominator.
          totalErrored += 1;
          break;
      }
    }

    // NoCoverage mutants are excluded from the score's denominator on purpose.
    // They measure reach, not strength: counting them would conflate "the tests
    // are weak" with "no test looks here", and those need different fixes. The
    // count is reported separately so the exclusion is visible.
    const evaluated = killed + survived;

    perFile.push({
      file,
      evaluated,
      killed,
      survived,
      noCoverage,
      score: evaluated > 0 ? reportProportion(killed, evaluated, "census", neverCalled) : null,
      coveringTestCount: coveringTestCountFor(file)
    });

    totalKilled += killed;
    totalSurvived += survived;
    totalNoCoverage += noCoverage;
  }

  perFile.sort((left, right) => {
    const leftScore = left.score?.observed ?? 2;
    const rightScore = right.score?.observed ?? 2;
    return leftScore - rightScore;
  });

  const evaluated = totalKilled + totalSurvived;
  const cpuList = cpus();

  return {
    schema_version: E10_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    host: {
      platform: platform(),
      arch: arch(),
      cpu_model: cpuList[0]?.model ?? "unknown",
      cpu_count: cpuList.length,
      total_memory_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      node_version: process.version
    },
    scope: {
      mutated_files: MUTATION_TEST_SCOPE.kernelFiles.length,
      test_files_in_scope: MUTATION_TEST_SCOPE.testFiles.length
    },
    totals: {
      evaluated,
      killed: totalKilled,
      survived: totalSurvived,
      noCoverage: totalNoCoverage,
      errored: totalErrored,
      ignored: totalIgnored
    },
    overall_score: evaluated > 0 ? reportProportion(totalKilled, evaluated, "census", neverCalled) : null,
    per_file: perFile,
    survivors: survivors.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
    non_claim: NON_CLAIM
  };
}

export function loadAndSummarize(reportPath: string = DEFAULT_REPORT): E10Report {
  if (!existsSync(reportPath)) {
    throw new Error(
      `ghost_ark.e10: no Stryker report at ${reportPath}. Run \`npm run mutation\` first — it is slow ` +
        "(hours, not minutes) and is intentionally not part of `npm run validate`."
    );
  }
  return summarizeStrykerReport(JSON.parse(readFileSync(reportPath, "utf8")) as StrykerReport);
}

/** CLI: `npm run mutation:summarize [-- --json] [-- <path-to-report.json>]` */
function main(): void {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const pathArg = args.find((arg) => !arg.startsWith("--"));
  const report = loadAndSummarize(pathArg ? resolve(pathArg) : DEFAULT_REPORT);

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E10 mutation score over the receipt trust kernel (${report.schema_version})`);
  lines.push(
    `host: ${report.host.platform}/${report.host.arch}, ${report.host.cpu_model} x${report.host.cpu_count}, ` +
      `${report.host.total_memory_gb} GB, node ${report.host.node_version}`
  );
  lines.push(
    `scope: ${report.scope.mutated_files} mutated files | ${report.scope.test_files_in_scope} test files | ` +
      `provenance: ${report.sample_provenance} (no confidence intervals)`
  );
  lines.push("");
  lines.push(
    `evaluated ${report.totals.evaluated} | killed ${report.totals.killed} | SURVIVED ${report.totals.survived} | ` +
      `no-coverage ${report.totals.noCoverage} | errored ${report.totals.errored} | ignored ${report.totals.ignored}`
  );
  if (report.overall_score) {
    lines.push(`overall mutation score: ${(report.overall_score.observed * 100).toFixed(1)}% (${report.totals.killed}/${report.totals.evaluated})`);
  }
  lines.push("");
  lines.push("file                                                          score    killed  SURVIVED  no-cover  covering-tests");
  for (const entry of report.per_file) {
    const score = entry.score ? `${(entry.score.observed * 100).toFixed(1)}%` : "n/a";
    lines.push(
      `${entry.file.padEnd(60)} ${score.padEnd(8)} ${String(entry.killed).padEnd(7)} ${String(entry.survived).padEnd(9)} ` +
        `${String(entry.noCoverage).padEnd(9)} ${entry.coveringTestCount ?? "?"}`
    );
  }
  lines.push("");
  lines.push(`surviving mutants (each is an edit to the trust kernel no test detects): ${report.survivors.length}`);
  for (const survivor of report.survivors) {
    const replacement = survivor.replacement ? ` -> ${survivor.replacement.replace(/\s+/g, " ").slice(0, 60)}` : "";
    lines.push(`  ${survivor.file}:${survivor.line} [${survivor.mutator}]${replacement}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
