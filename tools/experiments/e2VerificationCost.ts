/**
 * E2 — Cost of receipt verification, measured against an explicit baseline.
 *
 * What this replaces
 * ------------------
 * Prior latency reporting in this repository quoted bare point estimates with no
 * dispersion and no baseline, and at one point a figure was off by three orders of
 * magnitude (a microsecond result described in milliseconds). E2 fixes the
 * reporting contract:
 *
 *   1. Every operation reports p50 AND IQR (plus min/p95/p99/max/mean/stddev).
 *      A point estimate alone is not a result.
 *   2. Every operation is reported as a ratio against a declared baseline, so the
 *      number answers "what does verification cost me" rather than "what number did
 *      this machine print".
 *   3. Units are microseconds throughout, stated in the field names, because the
 *      historical error was a unit error.
 *   4. The host is recorded in the report. A latency figure without a machine is
 *      not reproducible.
 *
 * Provenance note: these are repeated measurements of a deterministic operation on
 * one machine, so the dispersion describes THIS host's scheduling noise. It is not a
 * sample from a population of machines, and the intervals in E1/E3's sense do not
 * apply. Do not quote these as cross-environment performance guarantees.
 *
 * NON-CLAIM: E2 measures wall-clock cost of local verification paths in one Node
 * process on one host. It is not a throughput claim, not a claim about AWS or KMS
 * latency, not a claim about behavior under concurrency or adversarial load, and not
 * evidence of safety, correctness, or compliance.
 */

import { createHash, createHmac, createPublicKey, constants, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { resolve } from "node:path";
import { summarize, type DispersionSummary } from "../../packages/research-frontier/src/stats/descriptive";
import { canonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import { loadEsmModule } from "./loadEsm";

export const E2_REPORT_SCHEMA_VERSION = "ghost.e2_verification_cost.v1";

const REPO_ROOT = resolve(__dirname, "../..");

/** Discarded iterations, to let the JIT reach steady state before measurement. */
const DEFAULT_WARMUP = 500;
/**
 * Measured iterations.
 *
 * 5000 rather than 2000, chosen empirically: at 2000 the monotonicity self-audit
 * intermittently reported an inversion between `canonicalize-only` and
 * `canonicalize-and-digest` — two costs about 1 µs apart with IQRs of 2+ µs, i.e. not
 * resolvable at that sample size. At 5000 the declared subset orderings hold consistently.
 * The default must match the iteration count quoted in docs/research/EXPERIMENTS.md §E2,
 * so that running the command reproduces the published table.
 */
const DEFAULT_TRIALS = 5000;

export interface OperationResult {
  operation: string;
  description: string;
  /** Whether this operation performs asymmetric crypto, symmetric crypto, or none. */
  cryptoClass: "none" | "hash" | "symmetric" | "asymmetric";
  microseconds: DispersionSummary;
  /** p50 of this operation divided by p50 of the baseline. Null for the baseline itself. */
  p50RatioToBaseline: number | null;
}

export interface E2Report {
  schema_version: typeof E2_REPORT_SCHEMA_VERSION;
  host: {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryGiB: number;
    nodeVersion: string;
  };
  configuration: { warmupIterations: number; measuredIterations: number; payloadBytes: number };
  baselineOperation: string;
  operations: OperationResult[];
  /**
   * Arms that were NOT measured, and why. Reported rather than silently omitted: a
   * missing asymmetric arm would otherwise make verification look cheaper than it is.
   */
  droppedOperations: { operation: string; reason: string }[];
  /**
   * Self-audit output. Some arms are strict supersets of others by construction
   * (canonicalize-and-digest does everything canonicalize-only does, plus a hash), so
   * the superset's p50 must be >= the subset's. When the measured ordering violates
   * that, this harness says so instead of publishing an impossible result. A violation
   * with overlapping IQRs means the two costs are not resolvable at this iteration
   * count — which is a finding about the measurement, not about the code.
   */
  monotonicityAudit: {
    subset: string;
    superset: string;
    holds: boolean;
    subsetP50: number;
    supersetP50: number;
    iqrsOverlap: boolean;
    interpretation: string;
  }[];
  non_claim: string;
}

/** Declared subset relationships, used by the monotonicity self-audit. */
const SUBSET_RELATIONS: { subset: string; superset: string }[] = [
  { subset: "canonicalize-only", superset: "canonicalize-and-digest" },
  { subset: "canonicalize-and-digest", superset: "hmac-verify" },
  { subset: "hmac-verify", superset: "verifier-full-hmac" },
  { subset: "json-parse-only", superset: "canonicalize-and-digest" }
];

function auditMonotonicity(operations: OperationResult[]): E2Report["monotonicityAudit"] {
  const byName = new Map(operations.map((operation) => [operation.operation, operation]));
  const audit: E2Report["monotonicityAudit"] = [];

  for (const relation of SUBSET_RELATIONS) {
    const subset = byName.get(relation.subset);
    const superset = byName.get(relation.superset);
    if (!subset || !superset) {
      continue;
    }

    const holds = superset.microseconds.p50 >= subset.microseconds.p50;
    const subsetHigh = subset.microseconds.p50 + subset.microseconds.iqr / 2;
    const subsetLow = subset.microseconds.p50 - subset.microseconds.iqr / 2;
    const supersetHigh = superset.microseconds.p50 + superset.microseconds.iqr / 2;
    const supersetLow = superset.microseconds.p50 - superset.microseconds.iqr / 2;
    const iqrsOverlap = subsetLow <= supersetHigh && supersetLow <= subsetHigh;

    audit.push({
      subset: relation.subset,
      superset: relation.superset,
      holds,
      subsetP50: subset.microseconds.p50,
      supersetP50: superset.microseconds.p50,
      iqrsOverlap,
      interpretation: holds
        ? "Ordering is as expected."
        : iqrsOverlap
          ? "VIOLATION, but the IQRs overlap: these two costs are not resolvable at this iteration count. Do not report either as cheaper than the other."
          : "VIOLATION with disjoint IQRs. This should not happen; treat it as a harness defect and investigate before quoting any number from this run."
    });
  }

  return audit;
}

const NON_CLAIM =
  "E2 measures wall-clock cost of local receipt-verification paths in a single Node.js process on the recorded host. " +
  "Dispersion describes this host's scheduling noise, not variation across machines. It is not a throughput claim, not " +
  "an AWS or KMS latency claim, not a claim about behavior under concurrency or adversarial load, and not evidence of " +
  "correctness, safety, or compliance.";

function nowMicroseconds(): number {
  return Number(process.hrtime.bigint()) / 1000;
}

/** Time a synchronous thunk `trials` times after `warmup` discarded runs. */
function measure(thunk: () => void, warmup: number, trials: number): number[] {
  for (let index = 0; index < warmup; index += 1) {
    thunk();
  }

  const observations: number[] = new Array<number>(trials);
  for (let index = 0; index < trials; index += 1) {
    const start = nowMicroseconds();
    thunk();
    observations[index] = nowMicroseconds() - start;
  }
  return observations;
}

/**
 * Guard against the classic benchmark defect: an operation whose result is unused,
 * which a JIT may eliminate entirely, producing an impressively small number for
 * work that never happened. Every thunk below feeds into this sink.
 */
let blackHole = 0;
function sink(value: unknown): void {
  // MUST be O(1) in the size of `value`. An earlier version used
  // `String(value).length`, which is O(n) and made `canonicalize-only` (a 1552-char
  // result) appear SLOWER than `canonicalize-and-digest` (a 64-char result) — the
  // harness was measuring its own sink. `String.prototype.length` is a constant-time
  // property read in V8, so reading it directly keeps the sink off the critical path.
  if (typeof value === "string") {
    blackHole = (blackHole + value.length) % 1_000_003;
    return;
  }
  if (typeof value === "boolean") {
    blackHole = (blackHole + (value ? 1 : 0)) % 1_000_003;
    return;
  }
  blackHole = (blackHole + 1) % 1_000_003;
}

export function readBlackHole(): number {
  return blackHole;
}

export interface E2Options {
  warmup?: number;
  trials?: number;
}

type VerifierModule = {
  verifyReceipt: (receipt: unknown, options?: Record<string, unknown>) => { verdict: string };
};

async function loadVerifier(): Promise<VerifierModule> {
  return loadEsmModule<VerifierModule>(resolve(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs"));
}

export async function runE2Cost(options: E2Options = {}): Promise<E2Report> {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const trials = options.trials ?? DEFAULT_TRIALS;
  const verifier = await loadVerifier();

  const receiptPath = resolve(REPO_ROOT, "examples/reproducibility/receipts/hmac-baseline.receipt.json");
  const receiptText = readFileSync(receiptPath, "utf8");
  const receipt = JSON.parse(receiptText) as Record<string, unknown>;
  const payload = (receipt.payload ?? receipt) as unknown;
  const canonicalForm = canonicalize(payload);

  const hmacSecret = "ghost-ark-repro-signing-dev-only-test-vector-v1";
  const hmacSignature = createHmac("sha256", hmacSecret).update(canonicalForm, "utf8").digest();

  type Arm = { operation: string; description: string; cryptoClass: OperationResult["cryptoClass"]; thunk: () => void };

  /**
   * Build a full-verifier arm, but only after asserting the fixture actually
   * verifies PASS. Benchmarking a failing verification would silently measure an
   * early-exit path and understate the cost — so a fixture that does not PASS is
   * dropped with a recorded reason rather than quietly measured.
   */
  const fullVerifierArms: Arm[] = [];
  const droppedArms: { operation: string; reason: string }[] = [];

  function addFullVerifierArm(operation: string, description: string, cryptoClass: OperationResult["cryptoClass"], fixtureRelativePath: string, verifyOptions: Record<string, unknown>): void {
    let fixture: unknown;
    try {
      fixture = JSON.parse(readFileSync(resolve(REPO_ROOT, fixtureRelativePath), "utf8"));
    } catch (error) {
      droppedArms.push({ operation, reason: `fixture unreadable: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    let verdict: string;
    try {
      verdict = verifier.verifyReceipt(fixture, verifyOptions).verdict;
    } catch (error) {
      droppedArms.push({ operation, reason: `verifier threw: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    if (verdict !== "PASS") {
      droppedArms.push({ operation, reason: `fixture does not PASS (verdict ${verdict}); benchmarking it would measure an early-exit path` });
      return;
    }

    fullVerifierArms.push({
      operation,
      description,
      cryptoClass,
      thunk: () => sink(verifier.verifyReceipt(fixture, verifyOptions).verdict)
    });
  }

  addFullVerifierArm(
    "verifier-full-hmac",
    "Full verifiers/node verifyReceipt() on the HMAC baseline fixture: schema, identity, digest, envelope, and dev-only HMAC signature.",
    "symmetric",
    "examples/reproducibility/receipts/hmac-baseline.receipt.json",
    { expectedKeyId: "local-dev-hmac", hmacSecret: hmacSecret }
  );

  addFullVerifierArm(
    "verifier-full-rsa-pss",
    "Full verifiers/node verifyReceipt() on the KMS-style RSASSA-PSS fixture: schema, identity, digest, envelope, and asymmetric signature.",
    "asymmetric",
    "examples/reproducibility/receipts/kms-style-rsa.receipt.json",
    {
      publicKeyPem: (() => {
        try {
          return readFileSync(resolve(REPO_ROOT, "examples/reproducibility/keys/kms-style-public-key.pem"), "utf8");
        } catch {
          return undefined;
        }
      })(),
      pssMode: "digest-as-message"
    }
  );

  const operations: Arm[] = [
    {
      operation: "json-parse-only",
      description: "JSON.parse of the receipt text. The floor: what any consumer pays just to read the document.",
      cryptoClass: "none",
      thunk: () => sink(JSON.parse(receiptText))
    },
    {
      operation: "canonicalize-only",
      description: "Deterministic canonical JSON serialization of the receipt payload, no hashing.",
      cryptoClass: "none",
      thunk: () => sink(canonicalize(payload))
    },
    {
      operation: "canonicalize-and-digest",
      description: "Canonicalization plus SHA-256. This is receipt identity computation.",
      cryptoClass: "hash",
      thunk: () => sink(createHash("sha256").update(canonicalize(payload), "utf8").digest("hex"))
    },
    {
      operation: "hmac-verify",
      description: "Canonicalize, then recompute and compare the dev-only HMAC-SHA256 tag.",
      cryptoClass: "symmetric",
      thunk: () => {
        const recomputed = createHmac("sha256", hmacSecret).update(canonicalize(payload), "utf8").digest();
        sink(recomputed.equals(hmacSignature));
      }
    }
  ];

  // Full end-to-end arms: the REAL standalone verifier, on the real fixtures, with
  // the real options. These are the numbers a reviewer actually cares about, because
  // they measure the code path `npm run receipt:verify:independent` executes rather
  // than a reconstruction of it. The micro-arms above exist only to decompose where
  // the cost goes.
  for (const arm of fullVerifierArms) {
    operations.push(arm);
  }

  const measured = operations.map((entry) => ({
    ...entry,
    microseconds: summarize(measure(entry.thunk, warmup, trials))
  }));

  const baseline = measured.find((entry) => entry.operation === "json-parse-only");
  if (!baseline) {
    throw new Error("ghost_ark.e2: baseline operation missing.");
  }

  const operationResults: OperationResult[] = measured.map((entry) => ({
    operation: entry.operation,
    description: entry.description,
    cryptoClass: entry.cryptoClass,
    microseconds: entry.microseconds,
    p50RatioToBaseline: entry.operation === baseline.operation ? null : entry.microseconds.p50 / baseline.microseconds.p50
  }));

  return {
    schema_version: E2_REPORT_SCHEMA_VERSION,
    host: {
      platform: platform(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      totalMemoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      nodeVersion: process.version
    },
    configuration: { warmupIterations: warmup, measuredIterations: trials, payloadBytes: Buffer.byteLength(canonicalForm, "utf8") },
    baselineOperation: baseline.operation,
    operations: operationResults,
    droppedOperations: droppedArms,
    monotonicityAudit: auditMonotonicity(operationResults),
    non_claim: NON_CLAIM
  };
}

function fixed(value: number, places = 3): string {
  return value.toFixed(places);
}

async function main(): Promise<void> {
  const trialsFlag = process.argv.indexOf("--trials");
  const trials = trialsFlag !== -1 ? Number(process.argv[trialsFlag + 1]) : undefined;
  const report = await runE2Cost(trials && Number.isFinite(trials) ? { trials } : {});

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E2 receipt verification cost (${report.schema_version})`);
  lines.push(`host: ${report.host.cpuModel} | ${report.host.platform}/${report.host.arch} | ${report.host.cpuCount} cpu | node ${report.host.nodeVersion}`);
  lines.push(
    `config: ${report.configuration.measuredIterations} measured iterations after ${report.configuration.warmupIterations} warmup | canonical payload ${report.configuration.payloadBytes} bytes`
  );
  lines.push(`baseline: ${report.baselineOperation}`);
  lines.push("");
  lines.push("operation                  crypto      p50 us     IQR us     p95 us     p99 us   xBaseline");
  for (const operation of report.operations) {
    const summary = operation.microseconds;
    lines.push(
      `${operation.operation.padEnd(26)} ${operation.cryptoClass.padEnd(11)} ${fixed(summary.p50).padStart(8)} ${fixed(summary.iqr).padStart(10)} ${fixed(summary.p95).padStart(10)} ${fixed(summary.p99).padStart(10)} ${(operation.p50RatioToBaseline === null ? "—" : `${fixed(operation.p50RatioToBaseline, 2)}x`).padStart(11)}`
    );
  }
  lines.push("");
  if (report.droppedOperations.length > 0) {
    lines.push(`NOT MEASURED (${report.droppedOperations.length}) — reported so a missing arm cannot make verification look cheaper than it is:`);
    for (const dropped of report.droppedOperations) {
      lines.push(`  - ${dropped.operation}: ${dropped.reason}`);
    }
    lines.push("");
  }
  const violations = report.monotonicityAudit.filter((entry) => !entry.holds);
  lines.push(`monotonicity self-audit: ${report.monotonicityAudit.length - violations.length}/${report.monotonicityAudit.length} declared subset orderings hold`);
  for (const violation of violations) {
    lines.push(`  ! ${violation.superset} (${fixed(violation.supersetP50)} us) measured cheaper than its subset ${violation.subset} (${fixed(violation.subsetP50)} us)`);
    lines.push(`    ${violation.interpretation}`);
  }
  lines.push("");
  lines.push("Reported as p50 with IQR. A point estimate without dispersion is not a result.");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
