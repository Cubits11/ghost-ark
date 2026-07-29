/**
 * E5 — Cross-language verifier agreement over the full corpus.
 *
 * The question
 * ------------
 * Ghost-Ark ships three independent receipt verifiers: a TypeScript canonicalizer in
 * `packages/receipt-schema`, a built-ins-only Node verifier in `verifiers/node`, and a Python
 * verifier in `verifiers/python`. Independence is the whole point — a receipt is only
 * verifiable evidence if a party who does not run your code can reach the same verdict.
 *
 * But independence is worthless unless the verdicts AGREE. Two verifiers that disagree on a
 * receipt mean at least one of them is wrong, and a consumer cannot know which. So:
 *
 *   For every receipt in the corpus, do all available verifiers reach the same verdict?
 *
 * Existing `tests/differential/` coverage checks agreement on selected fixtures. E5 runs the
 * full cross product — every corpus fixture and every valid fixture against every available
 * verifier — and reports each disagreement as a named defect rather than an aggregate score.
 *
 * Why disagreement is the headline and agreement is not
 * ----------------------------------------------------
 * A 100% agreement rate over a corpus where every verifier rejects everything is worthless.
 * E5 therefore reports agreement separately for the fixtures that SHOULD pass and the ones
 * that SHOULD fail, and treats a verifier that cannot run as unavailable rather than as
 * agreeing. A silently-absent verifier would inflate agreement to 100% by having nothing to
 * disagree with, which is the same defect class E1's Python probe guards against.
 *
 * NON-CLAIM: E5 establishes verdict agreement among the implemented verifiers over this
 * corpus under their documented rules. It is not evidence that any verdict is correct — three
 * implementations can share a misreading — and not evidence of model safety, semantic truth,
 * compliance, cryptographic strength, or AWS behavior.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { loadEsmModule } from "./loadEsm";
import { canonicalize, sha256Hex } from "../../packages/receipt-schema/src/hashCanonicalization";

export const E5_REPORT_SCHEMA_VERSION = "ghost.e5_verifier_agreement.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const REPRO_DIR = resolve(REPO_ROOT, "examples/reproducibility");

const HMAC_TEST_VECTOR = "ghost-ark-repro-signing-dev-only-test-vector-v1";
const HMAC_KEY_ID = "local-dev-hmac";

export type Verdict = "PASS" | "FAIL" | "ERROR";

export interface VerifierProbe {
  id: string;
  language: string;
  available: boolean;
  detail: string;
}

interface CorpusAttack {
  attack_id: string;
  attack_name: string;
  base_fixture_id: string;
  expected_rejection_phase?: string;
}

interface FixtureUnderTest {
  id: string;
  path: string;
  /** What the corpus declares SHOULD happen. */
  expected: "PASS" | "FAIL";
  /** True when only a consumer-supplied expectation can reject it (MAL-014). */
  consumerBoundary: boolean;
}

export interface AgreementRow {
  fixtureId: string;
  expected: "PASS" | "FAIL";
  consumerBoundary: boolean;
  verdicts: Record<string, Verdict>;
  /** True when the PEER verifiers (full verifiers only) returned the same verdict. */
  peersUnanimous: boolean;
  /** True when the peer verdict matches what the corpus declares. */
  matchesExpectation: boolean;
  /**
   * Subsumption holds when the weaker identity-only check does not reject something the full
   * verifiers accept. Identity failure must IMPLY verification failure; the converse need not
   * hold, because the full verifiers also check signatures the identity check never sees.
   */
  subsumptionHolds: boolean;
}

export interface E5Report {
  schema_version: typeof E5_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  probes: VerifierProbe[];
  availableVerifiers: string[];
  rows: AgreementRow[];
  /**
   * PEER verifiers only: the two full verifiers (Node built-ins-only, Python). Comparing a
   * deliberately weaker check against them as a peer would manufacture disagreements that are
   * simply the weaker check doing its job -- an earlier version of this experiment did exactly
   * that and reported 12 false "disagreements".
   */
  peerVerifiers: string[];
  /** The identity-only check, held to a subsumption property rather than to peer agreement. */
  subsumedVerifiers: string[];
  /** Peer agreement over fixtures the corpus says must FAIL. */
  agreementOnRejects: ProportionReport;
  /** Peer agreement over fixtures the corpus says must PASS. Without this, rejecting everything scores 100%. */
  agreementOnAccepts: ProportionReport;
  /** Fixtures where the PEER verifiers did not agree. Each is a genuine defect. */
  disagreements: { fixtureId: string; verdicts: Record<string, Verdict> }[];
  /**
   * Fixtures where the identity-only check REJECTED something a full verifier ACCEPTED. Each
   * would be a genuine soundness defect: a receipt whose identity does not recompute cannot be
   * validly accepted by a verifier that also recomputes identity.
   */
  subsumptionViolations: { fixtureId: string; verdicts: Record<string, Verdict> }[];
  non_claim: string;
}

/**
 * Full verifiers, compared to each other as peers. `ts-receipt-identity` is deliberately NOT
 * here: it checks receipt identity only and never verifies a signature, so holding it to peer
 * agreement would score its correct behavior as dissent.
 */
const PEER_VERIFIERS = ["node-independent", "python-independent"];

const NON_CLAIM =
  "E5 establishes verdict agreement among the implemented Ghost-Ark verifiers over this corpus under their documented " +
  "rules. Agreement is not correctness: three implementations can share a misreading. It is not evidence of model " +
  "safety, semantic truth, compliance, cryptographic strength, or AWS behavior.";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/* ------------------------------------------------------- Node verifier */

type NodeVerifierModule = {
  verifyReceipt: (receipt: unknown, options?: Record<string, unknown>) => { verdict: string };
};

let nodeVerifier: NodeVerifierModule | null = null;

function probeNodeVerifier(): VerifierProbe {
  try {
    nodeVerifier = loadEsmModule<NodeVerifierModule>(resolve(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs"));
    if (typeof nodeVerifier.verifyReceipt !== "function") {
      return { id: "node-independent", language: "JavaScript (ESM, built-ins only)", available: false, detail: "verifyReceipt not exported" };
    }
    return { id: "node-independent", language: "JavaScript (ESM, built-ins only)", available: true, detail: "verifiers/node/ghost_receipt_verify.mjs" };
  } catch (error) {
    return {
      id: "node-independent",
      language: "JavaScript (ESM, built-ins only)",
      available: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function verdictFromNode(fixture: FixtureUnderTest): Verdict {
  if (!nodeVerifier) {
    return "ERROR";
  }
  try {
    const receipt = readJson<unknown>(fixture.path);
    const report = nodeVerifier.verifyReceipt(receipt, { expectedKeyId: HMAC_KEY_ID, hmacSecret: HMAC_TEST_VECTOR });
    return report.verdict === "PASS" ? "PASS" : "FAIL";
  } catch {
    // A throw or unparseable document is a rejection, which for agreement purposes is FAIL.
    return "FAIL";
  }
}

/* ----------------------------------------------------- Python verifier */

const PYTHON_VERIFIER = resolve(REPO_ROOT, "verifiers/python/ghost_receipt_verify.py");

function probePythonVerifier(): VerifierProbe {
  if (!existsSync(PYTHON_VERIFIER)) {
    return { id: "python-independent", language: "Python", available: false, detail: "verifier script absent" };
  }
  try {
    const version = execFileSync("python3", ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
    return { id: "python-independent", language: "Python", available: true, detail: version };
  } catch (error) {
    return { id: "python-independent", language: "Python", available: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function verdictFromPython(fixture: FixtureUnderTest): Verdict {
  try {
    execFileSync(
      "python3",
      [PYTHON_VERIFIER, "--receipt", fixture.path, "--hmac-secret", HMAC_TEST_VECTOR, "--expected-key-id", HMAC_KEY_ID],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }
    );
    // Exit 0 is the verifier's PASS signal.
    return "PASS";
  } catch {
    return "FAIL";
  }
}

/* -------------------------------------------- TS canonicalizer verifier */

/**
 * The third arm checks the one property the TypeScript package genuinely owns: that a
 * decision receipt's `receipt_id` recomputes from the canonical form of the receipt with its
 * signature envelope and its own id removed. That is receipt IDENTITY, and it is the quantity
 * hashCanonicalization.ts exists to produce.
 *
 * It is a WEAKER check than the other two arms, which also verify the signature. Its
 * agreement is therefore interpreted as "identity agrees", not as a peer verdict on
 * authenticity, and it is reported as its own row rather than folded into a score.
 *
 * An earlier version of this arm compared `input_digest` against a recomputation of the
 * payload. Those are different quantities -- `input_digest` commits to the MODEL INPUT, not
 * to the receipt -- and the arm consequently disagreed with both real verifiers on valid
 * fixtures. That was a defect in this experiment, not in Ghost-Ark, and it is recorded here
 * because a harness that quietly measures the wrong field is exactly the failure mode E4
 * exists to catch.
 */
function probeTypeScriptCanonicalizer(): VerifierProbe {
  return {
    id: "ts-receipt-identity",
    language: "TypeScript (packages/receipt-schema)",
    available: true,
    detail: "receipt_id recomputation from the canonical unsigned receipt; no signature verification"
  };
}

function verdictFromTypeScript(fixture: FixtureUnderTest): Verdict {
  try {
    const receipt = readJson<Record<string, unknown>>(fixture.path);

    const declaredId = receipt.receipt_id;
    if (typeof declaredId !== "string") {
      // Nothing for this arm to check. ERROR, never a silent agreement.
      return "ERROR";
    }

    const { receipt_signature: _envelope, receipt_id: _id, ...canonicalIdentitySource } = receipt;
    const recomputed = `grct_${sha256Hex(canonicalize(canonicalIdentitySource))}`;
    return recomputed === declaredId ? "PASS" : "FAIL";
  } catch {
    return "FAIL";
  }
}

/* --------------------------------------------------------------- runner */

function collectFixtures(): FixtureUnderTest[] {
  const corpus = readJson<{ attacks: CorpusAttack[] }>(resolve(CORPUS_DIR, "manifest.json"));
  const repro = readJson<{ fixtures: { fixture_id: string; signature_alg: string }[] }>(resolve(REPRO_DIR, "manifest.json"));

  const fixtures: FixtureUnderTest[] = corpus.attacks.map((attack) => ({
    id: attack.attack_id,
    path: resolve(CORPUS_DIR, "receipts", `${attack.attack_id}.${attack.attack_name}.receipt.json`),
    expected: "FAIL",
    consumerBoundary: attack.expected_rejection_phase === "tenant_expectation"
  }));

  // The accept arm. Only the HMAC fixtures are used, because the shared verifier options
  // here are the HMAC ones; scoring an RSA fixture under HMAC options would measure option
  // mismatch, not agreement.
  for (const fixture of repro.fixtures) {
    if (fixture.signature_alg !== "LOCAL_HMAC_SHA256_DEV_ONLY") {
      continue;
    }
    fixtures.push({
      id: fixture.fixture_id,
      path: resolve(REPRO_DIR, "receipts", `${fixture.fixture_id}.receipt.json`),
      expected: "PASS",
      consumerBoundary: false
    });
  }

  return fixtures;
}

export function runE5Agreement(): E5Report {
  const probes = [probeNodeVerifier(), probePythonVerifier(), probeTypeScriptCanonicalizer()];
  const available = probes.filter((probe) => probe.available).map((probe) => probe.id);

  const verdictFns: Record<string, (fixture: FixtureUnderTest) => Verdict> = {
    "node-independent": verdictFromNode,
    "python-independent": verdictFromPython,
    "ts-receipt-identity": verdictFromTypeScript
  };

  const fixtures = collectFixtures();
  const rows: AgreementRow[] = [];
  const peersAvailable = available.filter((id) => PEER_VERIFIERS.includes(id));

  for (const fixture of fixtures) {
    const verdicts: Record<string, Verdict> = {};
    for (const verifierId of available) {
      verdicts[verifierId] = (verdictFns[verifierId] as (f: FixtureUnderTest) => Verdict)(fixture);
    }

    // Peer agreement is computed only over full verifiers that produced a verdict. An ERROR
    // is not a verdict and must not be counted as agreement.
    const peerDecided = Object.entries(verdicts).filter(([id, verdict]) => PEER_VERIFIERS.includes(id) && verdict !== "ERROR");
    const peerDistinct = new Set(peerDecided.map(([, verdict]) => verdict));
    const peersUnanimous = peerDecided.length > 1 && peerDistinct.size === 1;

    // Subsumption: identity FAIL must imply every peer also FAILs.
    const identityVerdict = verdicts["ts-receipt-identity"];
    const anyPeerPassed = peerDecided.some(([, verdict]) => verdict === "PASS");
    const subsumptionHolds = !(identityVerdict === "FAIL" && anyPeerPassed);

    rows.push({
      fixtureId: fixture.id,
      expected: fixture.expected,
      consumerBoundary: fixture.consumerBoundary,
      verdicts,
      peersUnanimous,
      matchesExpectation: peersUnanimous && peerDistinct.has(fixture.expected),
      subsumptionHolds
    });
  }

  const neverCalled = (): { low: number; high: number } => {
    throw new Error("ghost_ark.e5: an interval provider must never be invoked for a census.");
  };

  // MAL-014 is excluded from the reject arm: no verifier rule can reject it without a
  // consumer expectation, so counting it as a disagreement would be a category error.
  const rejectRows = rows.filter((row) => row.expected === "FAIL" && !row.consumerBoundary);
  const acceptRows = rows.filter((row) => row.expected === "PASS");

  return {
    schema_version: E5_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    probes,
    availableVerifiers: available,
    rows,
    peerVerifiers: peersAvailable,
    subsumedVerifiers: available.filter((id) => !PEER_VERIFIERS.includes(id)),
    agreementOnRejects: reportProportion(rejectRows.filter((row) => row.peersUnanimous).length, Math.max(1, rejectRows.length), "census", neverCalled),
    agreementOnAccepts: reportProportion(acceptRows.filter((row) => row.peersUnanimous).length, Math.max(1, acceptRows.length), "census", neverCalled),
    disagreements: rows.filter((row) => !row.peersUnanimous).map((row) => ({ fixtureId: row.fixtureId, verdicts: row.verdicts })),
    subsumptionViolations: rows.filter((row) => !row.subsumptionHolds).map((row) => ({ fixtureId: row.fixtureId, verdicts: row.verdicts })),
    non_claim: NON_CLAIM
  };
}

function main(): void {
  const report = runE5Agreement();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E5 cross-language verifier agreement (${report.schema_version})`);
  lines.push("");
  lines.push("verifier probes:");
  for (const probe of report.probes) {
    lines.push(`  ${probe.available ? "OK  " : "SKIP"} ${probe.id.padEnd(22)} ${probe.language.padEnd(42)} ${probe.detail}`);
  }
  lines.push("");
  lines.push(`peer verifiers (compared for unanimity): ${report.peerVerifiers.join(", ")}`);
  lines.push(`subsumed verifier (held to identity-implies-rejection):  ${report.subsumedVerifiers.join(", ") || "none"}`);
  lines.push("");
  lines.push(`peers unanimous on fixtures that must FAIL: ${report.agreementOnRejects.successes}/${report.agreementOnRejects.total}`);
  lines.push(`peers unanimous on fixtures that must PASS: ${report.agreementOnAccepts.successes}/${report.agreementOnAccepts.total}`);
  lines.push("  (both arms reported: agreement on rejects alone would be 100% for a verifier that rejects everything)");
  lines.push("");
  lines.push(`PEER DISAGREEMENTS: ${report.disagreements.length}`);
  for (const disagreement of report.disagreements) {
    const detail = Object.entries(disagreement.verdicts)
      .map(([verifierId, verdict]) => `${verifierId}=${verdict}`)
      .join(" ");
    lines.push(`  - ${disagreement.fixtureId}: ${detail}`);
  }
  lines.push("");
  lines.push(`SUBSUMPTION VIOLATIONS (identity rejected what a full verifier accepted): ${report.subsumptionViolations.length}`);
  for (const violation of report.subsumptionViolations) {
    const detail = Object.entries(violation.verdicts)
      .map(([verifierId, verdict]) => `${verifierId}=${verdict}`)
      .join(" ");
    lines.push(`  - ${violation.fixtureId}: ${detail}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
