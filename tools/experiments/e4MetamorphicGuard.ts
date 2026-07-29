/**
 * E4 — Metamorphic guard: are the detections load-bearing?
 *
 * The defect this exists to prevent
 * ---------------------------------
 * A detection benchmark can report 100% while measuring nothing. `dab/bench/attacks/`
 * contained several such checks — for example a "cross-request nonce swap detected"
 * result computed as
 *
 *     detected: requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce
 *
 * which is true by construction of the two fixtures and never invokes a nonce ledger,
 * a gateway, or a verifier. A green result there is a statement about the test's own
 * fixture construction, not about the system.
 *
 * The discriminator
 * -----------------
 * A genuine detection must STOP detecting when the mechanism responsible for it is
 * broken. A tautological one keeps "detecting" regardless. So for each named check in
 * the standalone verifier, E4:
 *
 *   1. builds a MUTANT verifier in which that one check is forced to pass,
 *   2. re-runs the entire malicious corpus against the mutant,
 *   3. records which attacks flipped from detected to undetected.
 *
 * An attack that flips is EVIDENCE-BACKED: its detection provably depends on that
 * mechanism. An attack that never flips under any single-check mutant is either
 * defended redundantly (several independent checks catch it) or not really being
 * tested — and E4 distinguishes those two cases by also running an all-checks mutant.
 *
 * This is the same discipline as the mutant-paired TLA+ specifications in `proofs/`:
 * a property is only interesting once you show the model fails without it.
 *
 * NON-CLAIM: E4 establishes that specific verifier checks are load-bearing for
 * specific corpus fixtures under this verifier's rules. It is not evidence of
 * cryptographic strength, completeness of the corpus, model safety, semantic truth,
 * compliance, or AWS behavior. A check with no dependent fixtures is a gap in the
 * corpus, not proof the check is useless.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadEsmModule } from "./loadEsm";

export const E4_REPORT_SCHEMA_VERSION = "ghost.e4_metamorphic_guard.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const VERIFIER_PATH = resolve(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const REPRO_DIR = resolve(REPO_ROOT, "examples/reproducibility");

/**
 * The exact source text of the verifier's check factory. E4 mutates this single
 * function, which is the only place a check verdict is constructed.
 *
 * If this string ever fails to match, E4 throws rather than silently skipping: a
 * mutation harness that quietly stops mutating would report "all checks load-bearing"
 * while testing nothing — precisely the failure mode E4 exists to catch.
 */
const CHECK_FACTORY_SOURCE = `function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail };
}`;

/** Every check name the verifier can emit. */
export const CHECK_NAMES = [
  "schema",
  "receipt_id",
  "digest",
  "signature",
  "envelope",
  "key_id",
  "canonical_payload",
  "configuration",
  "tenant",
  "tenant_expectation"
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];

interface CorpusAttack {
  attack_id: string;
  attack_name: string;
  base_fixture_id: string;
  expected_rejection_phase?: string;
}

interface ReproFixture {
  fixture_id: string;
  signature_alg: string;
  signing?: { key_id?: string; hmac_secret_dev_only_test_vector?: string };
  identity?: Record<string, unknown>;
}

type VerifierModule = {
  verifyReceipt: (receipt: unknown, options?: Record<string, unknown>) => { verdict: string; checks: { name: string; passed: boolean }[] };
};



export interface MutantResult {
  /** Which check was neutered. "ALL" forces every check to pass. */
  mutatedCheck: CheckName | "ALL";
  /** Attacks that the baseline detected but this mutant did not. */
  flippedToUndetected: string[];
  /** Attacks still detected under the mutant (redundantly defended, or independent of this check). */
  stillDetected: number;
  /**
   * True when the unmutated base fixtures still PASS under the mutant. They must:
   * a mutant that forces a check to pass cannot make a valid receipt invalid, so a
   * false here means the mutation broke something unrelated and the row is unsound.
   */
  controlArmIntact: boolean;
}

export interface E4Report {
  schema_version: typeof E4_REPORT_SCHEMA_VERSION;
  baselineDetected: number;
  corpusSize: number;
  mutants: MutantResult[];
  /**
   * Checks whose mutation flipped at least one attack. These are proven load-bearing
   * for this corpus.
   */
  loadBearingChecks: CheckName[];
  /**
   * Checks whose mutation flipped nothing. Either redundantly covered or untested by
   * this corpus. Reported as a corpus gap, never as evidence the check is unnecessary.
   */
  noDependentFixtures: CheckName[];
  /**
   * THE TAUTOLOGY VERDICT. When every check is forced to pass, a sound corpus should
   * lose nearly all of its detections. Attacks still "detected" under the ALL mutant
   * are detected by something other than verifier logic — parse failure is legitimate,
   * anything else is a tautology to investigate.
   */
  survivesAllChecksMutant: string[];
  tautology_verdict: string;
  non_claim: string;
}

const NON_CLAIM =
  "E4 establishes that specific verifier checks are load-bearing for specific corpus fixtures under this verifier's " +
  "documented rules. It is not evidence of cryptographic strength, corpus completeness, model safety, semantic truth, " +
  "compliance, or AWS behavior. A check with no dependent fixtures indicates a corpus gap, not a useless check.";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write a mutated copy of the verifier and return its absolute filesystem path. */
function buildMutant(targetCheck: CheckName | "ALL", scratchDir: string): string {
  const source = readFileSync(VERIFIER_PATH, "utf8");

  if (!source.includes(CHECK_FACTORY_SOURCE)) {
    throw new Error(
      "ghost_ark.e4: the verifier's check() factory no longer matches CHECK_FACTORY_SOURCE. " +
        "E4 refuses to run rather than silently produce an all-green 'everything is load-bearing' report. " +
        "Update CHECK_FACTORY_SOURCE in tools/experiments/e4MetamorphicGuard.ts to the current source."
    );
  }

  const condition = targetCheck === "ALL" ? "true" : `name === ${JSON.stringify(targetCheck)}`;
  const mutatedFactory = `function check(name, passed, detail) {
  if (${condition}) { return { name, passed: true, detail: "E4 MUTANT: check forced to pass" }; }
  return { name, passed: Boolean(passed), detail };
}`;

  const mutatedSource = source.replace(CHECK_FACTORY_SOURCE, mutatedFactory);
  const mutantPath = join(scratchDir, `mutant_${String(targetCheck).replace(/[^a-z_]/gi, "")}.mjs`);
  writeFileSync(mutantPath, mutatedSource, "utf8");
  return mutantPath;
}

function optionsForFixture(fixture: ReproFixture | undefined): Record<string, unknown> {
  if (!fixture) {
    return {};
  }
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
  if (fixture.signature_alg !== "LOCAL_HMAC_SHA256_DEV_ONLY") {
    try {
      options.publicKeyPem = readFileSync(resolve(REPRO_DIR, "keys/kms-style-public-key.pem"), "utf8");
    } catch {
      /* recorded upstream as a dropped arm */
    }
  }
  return options;
}

/** Run the whole corpus against one verifier module; return the set of detected attack ids. */
function detectedSet(
  verifier: VerifierModule,
  attacks: CorpusAttack[],
  fixtureById: Map<string, ReproFixture>
): Set<string> {
  const detected = new Set<string>();

  for (const attack of attacks) {
    const receiptPath = resolve(CORPUS_DIR, "receipts", `${attack.attack_id}.${attack.attack_name}.receipt.json`);
    let receipt: unknown;
    try {
      receipt = readJson<unknown>(receiptPath);
    } catch {
      // Parse failure is a legitimate rejection that no check mutation can undo.
      detected.add(attack.attack_id);
      continue;
    }

    try {
      const report = verifier.verifyReceipt(receipt, optionsForFixture(fixtureById.get(attack.base_fixture_id)));
      if (report.verdict !== "PASS") {
        detected.add(attack.attack_id);
      }
    } catch {
      detected.add(attack.attack_id);
    }
  }

  return detected;
}

function baseFixturesPass(verifier: VerifierModule, fixtures: ReproFixture[]): boolean {
  return fixtures.every((fixture) => {
    const receiptPath = resolve(REPRO_DIR, "receipts", `${fixture.fixture_id}.receipt.json`);
    try {
      return verifier.verifyReceipt(readJson<unknown>(receiptPath), optionsForFixture(fixture)).verdict === "PASS";
    } catch {
      return false;
    }
  });
}

export async function runE4Guard(): Promise<E4Report> {
  const corpus = readJson<{ attacks: CorpusAttack[] }>(resolve(CORPUS_DIR, "manifest.json"));
  const repro = readJson<{ fixtures: ReproFixture[] }>(resolve(REPRO_DIR, "manifest.json"));
  const fixtureById = new Map(repro.fixtures.map((fixture) => [fixture.fixture_id, fixture]));

  const scratchDir = mkdtempSync(join(tmpdir(), "ghost-ark-e4-"));

  const baseline = loadEsmModule<VerifierModule>(VERIFIER_PATH);
  const baselineDetected = detectedSet(baseline, corpus.attacks, fixtureById);

  const mutants: MutantResult[] = [];
  const targets: (CheckName | "ALL")[] = [...CHECK_NAMES, "ALL"];

  for (const target of targets) {
    const mutantPath = buildMutant(target, scratchDir);
    const mutant = loadEsmModule<VerifierModule>(mutantPath);
    const mutantDetected = detectedSet(mutant, corpus.attacks, fixtureById);

    const flipped = [...baselineDetected].filter((attackId) => !mutantDetected.has(attackId));

    mutants.push({
      mutatedCheck: target,
      flippedToUndetected: flipped,
      stillDetected: mutantDetected.size,
      controlArmIntact: baseFixturesPass(mutant, repro.fixtures)
    });
  }

  const allMutant = mutants.find((entry) => entry.mutatedCheck === "ALL");
  const allMutantDetectedIds = allMutant
    ? [...baselineDetected].filter((attackId) => !allMutant.flippedToUndetected.includes(attackId))
    : [];

  const loadBearing = mutants
    .filter((entry) => entry.mutatedCheck !== "ALL" && entry.flippedToUndetected.length > 0)
    .map((entry) => entry.mutatedCheck as CheckName);

  const noDependents = mutants
    .filter((entry) => entry.mutatedCheck !== "ALL" && entry.flippedToUndetected.length === 0)
    .map((entry) => entry.mutatedCheck as CheckName);

  // Under the ALL mutant, only rejections that do not come from check logic should
  // survive. Parse failures are legitimate; anything else warrants investigation.
  const parseFailureIds = corpus.attacks
    .filter((attack) => {
      try {
        readJson<unknown>(resolve(CORPUS_DIR, "receipts", `${attack.attack_id}.${attack.attack_name}.receipt.json`));
        return false;
      } catch {
        return true;
      }
    })
    .map((attack) => attack.attack_id);

  const unexplainedSurvivors = allMutantDetectedIds.filter((attackId) => !parseFailureIds.includes(attackId));

  const tautologyVerdict =
    unexplainedSurvivors.length === 0
      ? `PASS: with every check forced to pass, all ${allMutantDetectedIds.length} remaining detections are parse failures. No corpus detection is tautological under this verifier.`
      : `INVESTIGATE: ${unexplainedSurvivors.length} attack(s) still reported as detected with every check forced to pass, and they are not parse failures: ${unexplainedSurvivors.join(", ")}. Detection is coming from somewhere other than verifier check logic.`;

  return {
    schema_version: E4_REPORT_SCHEMA_VERSION,
    baselineDetected: baselineDetected.size,
    corpusSize: corpus.attacks.length,
    mutants,
    loadBearingChecks: loadBearing,
    noDependentFixtures: noDependents,
    survivesAllChecksMutant: allMutantDetectedIds,
    tautology_verdict: tautologyVerdict,
    non_claim: NON_CLAIM
  };
}

async function main(): Promise<void> {
  const report = await runE4Guard();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E4 metamorphic guard (${report.schema_version})`);
  lines.push(`baseline: ${report.baselineDetected}/${report.corpusSize} corpus attacks detected by the unmutated verifier`);
  lines.push("");
  lines.push("mutated check          flipped-to-undetected  still-detected  control-arm-intact");
  for (const mutant of report.mutants) {
    lines.push(
      `${String(mutant.mutatedCheck).padEnd(22)} ${String(mutant.flippedToUndetected.length).padEnd(22)} ${String(mutant.stillDetected).padEnd(15)} ${mutant.controlArmIntact}`
    );
  }
  lines.push("");
  lines.push(`load-bearing checks (mutation flipped >= 1 attack): ${report.loadBearingChecks.length}`);
  for (const mutant of report.mutants) {
    if (mutant.mutatedCheck !== "ALL" && mutant.flippedToUndetected.length > 0) {
      lines.push(`  ${String(mutant.mutatedCheck).padEnd(20)} <- ${mutant.flippedToUndetected.join(", ")}`);
    }
  }
  lines.push("");
  lines.push(`checks with NO dependent corpus fixture (corpus gap, not a useless check): ${report.noDependentFixtures.join(", ") || "none"}`);
  lines.push("");
  lines.push(`TAUTOLOGY VERDICT: ${report.tautology_verdict}`);
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
