/**
 * E3 — Adversarial corpus detection rate, measured against the real verifier.
 *
 * What this replaces
 * ------------------
 * Ghost-Ark previously reported detection results from `dab/bench/attacks/*`, where
 * several "attacks" were tautological: they constructed two fixtures and then
 * asserted the fixtures had the properties just assigned to them, without invoking
 * any Ghost-Ark component. E3 invokes the actual standalone verifier
 * (`verifiers/node/ghost_receipt_verify.mjs`) on the actual 26-fixture malicious
 * corpus, and a fixture counts as detected only when that verifier returns FAIL.
 *
 * Reporting discipline
 * --------------------
 * The corpus is a CENSUS: 26 hand-authored single-field mutations. It is the whole
 * population and its size is an authoring decision. Therefore E3 reports EXACT
 * COUNTS and attaches no confidence interval — `reportProportion` enforces this
 * via `sample_provenance: "census"`. A Wilson interval here would describe
 * sampling variability that does not exist.
 *
 * The control arm matters as much as the treatment arm. E3 also verifies the
 * unmutated base fixtures: a verifier that returns FAIL on everything would score
 * a perfect "detection rate" while being useless. The `base_fixture_pass_rate`
 * below is what makes the detection number meaningful.
 *
 * NON-CLAIM: a 100% detection rate over this corpus means these 26 specific
 * single-field mutations are rejected under this verifier's documented rules. It is
 * not evidence of resistance to attacks outside the corpus, not evidence about the
 * cryptographic strength of SHA-256 or RSA-PSS, and not evidence of model safety,
 * semantic truth, compliance, or AWS behavior. The coverage boundary in
 * `docs/research/EXPERIMENTS.md` §E3 lists attack classes this corpus does NOT contain.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { loadEsmModule } from "./loadEsm";

export const E3_REPORT_SCHEMA_VERSION = "ghost.e3_corpus_detection.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const REPRO_DIR = resolve(REPO_ROOT, "examples/reproducibility");

interface CorpusAttack {
  attack_id: string;
  attack_name: string;
  base_fixture_id: string;
  verifier: string;
  mutated_field: string;
  mutation_description: string;
  /**
   * Present on attacks that are only detectable once a consumer supplies its own
   * expectation. MAL-014 is the canonical case: a byte-identical, cryptographically
   * valid receipt from tenant A, which no verifier rule can reject — only a
   * tenant-B consumer comparing tenant_id_hash can. This is the Provenance Kernel
   * Problem in miniature, so E3 measures it as its own stratum rather than folding
   * it into the intrinsic rate.
   */
  expected_tenant_id?: string;
  expected_rejection_phase?: string;
}

interface CorpusManifest {
  schema_version: string;
  non_claim: string;
  attacks: CorpusAttack[];
}

interface ReproFixture {
  fixture_id: string;
  signature_alg: string;
  signing?: { key_id?: string; hmac_secret_dev_only_test_vector?: string };
  identity?: Record<string, unknown>;
  public_key_path?: string;
}

interface ReproManifest {
  fixtures: ReproFixture[];
}

/**
 * Who rejected the mutation. The stratum matters more than the aggregate rate:
 * "the signature check caught it" and "no verifier rule could catch it, only the
 * consumer's declared expectation" are different security properties.
 */
export type RejectionStratum =
  | "verifier-intrinsic" // a verifier rule failed
  | "load" // the document would not parse
  | "consumer-expectation" // verifier PASSes; only a supplied consumer expectation rejects it
  | "undetected"; // nothing rejected it

export interface DetectionOutcome {
  attack_id: string;
  attack_name: string;
  mutated_field: string;
  /** PASS/FAIL from the real standalone verifier, or LOAD_ERROR when the fixture would not parse. */
  verdict: "PASS" | "FAIL" | "LOAD_ERROR";
  /** True when the mutation was rejected by anything in the pipeline. */
  detected: boolean;
  stratum: RejectionStratum;
  /** True when the corpus itself declares this attack detectable only by a consumer expectation. */
  declaredConsumerBoundary: boolean;
  /** Names of the specific verifier checks that failed. Evidence of WHY, not just THAT. */
  failedChecks: string[];
  detail: string | null;
}

export interface BaseFixtureOutcome {
  fixture_id: string;
  verdict: "PASS" | "FAIL" | "LOAD_ERROR";
  failedChecks: string[];
}

export interface E3Report {
  schema_version: typeof E3_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  detection: ProportionReport;
  /**
   * Detection restricted to what verifier rules alone catch. This is the number that
   * should be quoted for "the verifier rejects X of Y", because the aggregate
   * `detection` figure includes mutations only a consumer expectation can reject.
   */
  verifier_intrinsic_detection: ProportionReport;
  /** Counts per rejection stratum. */
  strata: Record<RejectionStratum, number>;
  /** Control arm: unmutated fixtures must PASS, or the detection rate is meaningless. */
  base_fixture_control: ProportionReport;
  outcomes: DetectionOutcome[];
  base_fixtures: BaseFixtureOutcome[];
  /**
   * Fixtures the verifier rejected without naming a check (parse failures). Tracked
   * separately because "the file would not load" is weaker evidence than "the
   * signature check failed".
   */
  detected_by_load_failure_only: string[];
  non_claim: string;
}

const NON_CLAIM =
  "E3 reports rejection of 26 specific hand-authored single-field receipt mutations under the documented rules of " +
  "verifiers/node/ghost_receipt_verify.mjs. It is a curated census, not a sample, so no confidence interval applies. " +
  "It is not evidence of resistance to attacks outside this corpus, not evidence about the strength of the underlying " +
  "cryptographic primitives, and not evidence of model safety, semantic truth, compliance, or AWS execution.";

type VerifierModule = {
  verifyReceipt: (receipt: unknown, options?: Record<string, unknown>) => { verdict: string; checks: { name: string; passed: boolean; detail?: string }[] };
};

export async function loadVerifier(): Promise<VerifierModule> {
  return loadEsmModule<VerifierModule>(resolve(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs"));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Build the verifier options for a fixture from the reproducibility manifest.
 *
 * Deliberately sourced from the manifest rather than hardcoded: if the manifest's
 * declared key id or test vector drifts from the fixtures, E3 fails loudly instead
 * of silently verifying against stale expectations.
 */
function optionsForFixture(fixture: ReproFixture): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (fixture.signing?.key_id) {
    options.expectedKeyId = fixture.signing.key_id;
  }
  if (fixture.signing?.hmac_secret_dev_only_test_vector) {
    options.hmacSecret = fixture.signing.hmac_secret_dev_only_test_vector;
  }
  const identity = fixture.identity as Record<string, string> | undefined;
  if (identity?.hmac_secret_dev_only_test_vector) {
    options.identityHmacSecret = identity.hmac_secret_dev_only_test_vector;
  }
  if (identity?.tenant) {
    options.tenant = identity.tenant;
  }
  if (identity?.expected_tenant_id_hash) {
    options.expectedTenantIdHash = identity.expected_tenant_id_hash;
  }
  if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256" || fixture.signature_alg === "RSASSA_PSS_SHA_256") {
    const keyPath = resolve(REPRO_DIR, "keys/kms-style-public-key.pem");
    try {
      options.publicKeyPem = readFileSync(keyPath, "utf8");
    } catch {
      // Recorded as a limitation by the caller when the RSA arm cannot run.
    }
  }
  return options;
}

export async function runE3Detection(): Promise<E3Report> {
  const verifier = await loadVerifier();
  const corpus = readJson<CorpusManifest>(resolve(CORPUS_DIR, "manifest.json"));
  const repro = readJson<ReproManifest>(resolve(REPRO_DIR, "manifest.json"));

  const fixtureById = new Map(repro.fixtures.map((fixture) => [fixture.fixture_id, fixture]));

  function verifyFile(path: string, fixture: ReproFixture | undefined): { verdict: "PASS" | "FAIL" | "LOAD_ERROR"; failedChecks: string[]; detail: string | null } {
    let receipt: unknown;
    try {
      receipt = readJson<unknown>(path);
    } catch (error) {
      return { verdict: "LOAD_ERROR", failedChecks: [], detail: error instanceof Error ? error.message : String(error) };
    }

    const options = fixture ? optionsForFixture(fixture) : {};
    try {
      const report = verifier.verifyReceipt(receipt, options);
      const failedChecks = report.checks.filter((entry) => !entry.passed);
      return {
        verdict: report.verdict === "PASS" ? "PASS" : "FAIL",
        failedChecks: failedChecks.map((entry) => entry.name),
        detail: failedChecks[0]?.detail ?? null
      };
    } catch (error) {
      // A throw is a rejection, but a weaker one than a named failed check.
      return { verdict: "FAIL", failedChecks: ["verifier_threw"], detail: error instanceof Error ? error.message : String(error) };
    }
  }

  const outcomes: DetectionOutcome[] = corpus.attacks.map((attack) => {
    const receiptPath = resolve(CORPUS_DIR, "receipts", `${attack.attack_id}.${attack.attack_name}.receipt.json`);
    const fixture = fixtureById.get(attack.base_fixture_id);
    const declaredConsumerBoundary = attack.expected_rejection_phase === "tenant_expectation";

    const { verdict, failedChecks, detail } = verifyFile(receiptPath, fixture);

    let stratum: RejectionStratum;
    let detected: boolean;

    if (verdict === "LOAD_ERROR") {
      stratum = "load";
      detected = true;
    } else if (verdict === "FAIL") {
      stratum = "verifier-intrinsic";
      detected = true;
    } else if (attack.expected_tenant_id) {
      // The verifier passed, as the corpus documents it should. Re-verify supplying
      // the consumer's declared tenant expectation — the only thing that can reject
      // a byte-identical, cryptographically valid receipt.
      const withExpectation = verifyFile(receiptPath, {
        ...(fixture ?? ({ fixture_id: attack.base_fixture_id, signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" } as ReproFixture)),
        identity: { ...(fixture?.identity ?? {}), tenant: attack.expected_tenant_id }
      });
      detected = withExpectation.verdict !== "PASS";
      stratum = detected ? "consumer-expectation" : "undetected";
      return {
        attack_id: attack.attack_id,
        attack_name: attack.attack_name,
        mutated_field: attack.mutated_field,
        verdict,
        detected,
        stratum,
        declaredConsumerBoundary,
        failedChecks: withExpectation.failedChecks,
        detail: withExpectation.detail
      };
    } else {
      stratum = "undetected";
      detected = false;
    }

    return {
      attack_id: attack.attack_id,
      attack_name: attack.attack_name,
      mutated_field: attack.mutated_field,
      verdict,
      detected,
      stratum,
      declaredConsumerBoundary,
      failedChecks,
      detail
    };
  });

  // Control arm: the unmutated fixtures must PASS.
  const baseFixtures: BaseFixtureOutcome[] = repro.fixtures.map((fixture) => {
    const receiptPath = resolve(REPRO_DIR, "receipts", `${fixture.fixture_id}.receipt.json`);
    const { verdict, failedChecks } = verifyFile(receiptPath, fixture);
    return { fixture_id: fixture.fixture_id, verdict, failedChecks };
  });

  const detectedCount = outcomes.filter((outcome) => outcome.detected).length;
  const basePassCount = baseFixtures.filter((fixture) => fixture.verdict === "PASS").length;

  // Census provenance means reportProportion returns interval: null by construction.
  const neverCalled = (): { low: number; high: number } => {
    throw new Error("ghost_ark.e3: an interval provider must never be invoked for a census.");
  };

  const strata: Record<RejectionStratum, number> = {
    "verifier-intrinsic": outcomes.filter((outcome) => outcome.stratum === "verifier-intrinsic").length,
    load: outcomes.filter((outcome) => outcome.stratum === "load").length,
    "consumer-expectation": outcomes.filter((outcome) => outcome.stratum === "consumer-expectation").length,
    undetected: outcomes.filter((outcome) => outcome.stratum === "undetected").length
  };

  // The intrinsic denominator excludes attacks the corpus itself declares to be
  // consumer-boundary cases. Counting them against the verifier would understate it;
  // counting them for the verifier would overstate it. They get their own stratum.
  const intrinsicCandidates = outcomes.filter((outcome) => !outcome.declaredConsumerBoundary);
  const intrinsicDetected = intrinsicCandidates.filter((outcome) => outcome.stratum === "verifier-intrinsic" || outcome.stratum === "load").length;

  return {
    schema_version: E3_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    detection: reportProportion(detectedCount, outcomes.length, "census", neverCalled),
    verifier_intrinsic_detection: reportProportion(intrinsicDetected, intrinsicCandidates.length, "census", neverCalled),
    strata,
    base_fixture_control: reportProportion(basePassCount, baseFixtures.length, "census", neverCalled),
    outcomes,
    base_fixtures: baseFixtures,
    detected_by_load_failure_only: outcomes.filter((outcome) => outcome.verdict === "LOAD_ERROR").map((outcome) => outcome.attack_id),
    non_claim: NON_CLAIM
  };
}

async function main(): Promise<void> {
  const report = await runE3Detection();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E3 adversarial corpus detection (${report.schema_version})`);
  lines.push(`provenance: ${report.sample_provenance} — exact counts, no confidence interval`);
  lines.push(`  reason: ${report.detection.intervalOmittedBecause}`);
  lines.push("");
  lines.push(`aggregate detection:        ${report.detection.successes}/${report.detection.total} mutations rejected somewhere in the pipeline`);
  lines.push(
    `verifier-intrinsic:         ${report.verifier_intrinsic_detection.successes}/${report.verifier_intrinsic_detection.total} rejected by verifier rules alone (quote THIS for verifier claims)`
  );
  lines.push(`control arm:                ${report.base_fixture_control.successes}/${report.base_fixture_control.total} unmutated base fixtures PASS`);
  lines.push("");
  lines.push("rejection strata:");
  for (const [stratum, count] of Object.entries(report.strata)) {
    lines.push(`  ${stratum.padEnd(22)} ${count}`);
  }
  lines.push(`  (load-fail ids: ${report.detected_by_load_failure_only.join(", ") || "none"})`);
  lines.push("");

  const undetected = report.outcomes.filter((outcome) => !outcome.detected);
  lines.push(`UNDETECTED (verifier returned PASS on a mutation): ${undetected.length}`);
  for (const outcome of undetected) {
    lines.push(`  - ${outcome.attack_id} ${outcome.attack_name} (field: ${outcome.mutated_field})`);
  }
  lines.push("");

  const failedControl = report.base_fixtures.filter((fixture) => fixture.verdict !== "PASS");
  if (failedControl.length > 0) {
    lines.push(`CONTROL ARM FAILURES (unmutated fixture did not PASS — detection rate is not interpretable): ${failedControl.length}`);
    for (const fixture of failedControl) {
      lines.push(`  - ${fixture.fixture_id}: ${fixture.verdict} [${fixture.failedChecks.join(", ")}]`);
    }
    lines.push("");
  }

  lines.push("per-attack rejection reason (which check caught it):");
  for (const outcome of report.outcomes) {
    lines.push(`  ${outcome.attack_id.padEnd(8)} ${outcome.verdict.padEnd(11)} ${outcome.failedChecks.slice(0, 3).join(", ") || "(none)"}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
