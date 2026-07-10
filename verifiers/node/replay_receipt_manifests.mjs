#!/usr/bin/env node

/**
 * Standalone manifest-driven replay for the committed receipt fixtures.
 *
 * This adapter imports only Node.js built-ins and the builtins-only verifier
 * beside it. It reads local artifacts, performs no network or AWS calls, and
 * emits one deterministic JSON report to stdout.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyReceipt } from "./ghost_receipt_verify.mjs";

export const REPLAY_REPORT_SCHEMA_VERSION = "ghost.node_manifest_replay_report.v1";

const REPRO_SCHEMA_VERSION = "ghost.repro_manifest.v1";
const EXPECTED_DIGESTS_SCHEMA_VERSION = "ghost.repro_expected_digests.v1";
const CORPUS_SCHEMA_VERSION = "ghost.malicious_receipt_corpus.v1";
const HMAC_ALGORITHM = "LOCAL_HMAC_SHA256_DEV_ONLY";
const KMS_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256";
const DEFAULT_REPRO_MANIFEST = "examples/reproducibility/manifest.json";
const DEFAULT_CORPUS_MANIFEST = "examples/malicious-receipts/manifest.json";

const NON_CLAIM =
  "This report records local replay outcomes for the declared fixtures under the standalone verifier rules. " +
  "It does not establish complete attack coverage, external review, AWS execution, KMS custody, runtime integrity, " +
  "model safety, semantic truth, or compliance.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function readJsonArtifact(path, label) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new TypeError(`${label} could not be read.`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${label} is not valid JSON.`);
  }
}

function displayPath(path) {
  const fromCwd = relative(process.cwd(), path);
  const normalized = (fromCwd.length === 0 ? "." : fromCwd).split(sep).join("/");
  return normalized.startsWith("../") ? path.split(sep).join("/") : normalized;
}

function validateReproManifest(value) {
  const manifest = requireRecord(value, "Repro manifest");
  if (manifest.schema_version !== REPRO_SCHEMA_VERSION) {
    throw new TypeError(`Repro manifest schema_version must be ${REPRO_SCHEMA_VERSION}.`);
  }
  requireNonEmptyString(manifest.expected_digests_path, "Repro manifest expected_digests_path");
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new TypeError("Repro manifest fixtures must be a non-empty array.");
  }

  const fixtureIds = new Set();
  for (const [index, valueAtIndex] of manifest.fixtures.entries()) {
    const fixture = requireRecord(valueAtIndex, `Repro fixture ${index}`);
    const fixtureId = requireNonEmptyString(fixture.fixture_id, `Repro fixture ${index} fixture_id`);
    if (fixtureIds.has(fixtureId)) {
      throw new TypeError(`Repro manifest contains duplicate fixture_id ${fixtureId}.`);
    }
    fixtureIds.add(fixtureId);
    if (fixture.signature_alg !== HMAC_ALGORITHM && fixture.signature_alg !== KMS_ALGORITHM) {
      throw new TypeError(`Repro fixture ${fixtureId} has unsupported signature_alg.`);
    }
    const signing = requireRecord(fixture.signing, `Repro fixture ${fixtureId} signing`);
    requireNonEmptyString(signing.key_id, `Repro fixture ${fixtureId} signing.key_id`);
    if (fixture.signature_alg === HMAC_ALGORITHM) {
      requireNonEmptyString(
        signing.hmac_secret_dev_only_test_vector,
        `Repro fixture ${fixtureId} signing.hmac_secret_dev_only_test_vector`
      );
    } else {
      requireNonEmptyString(signing.public_key_path, `Repro fixture ${fixtureId} signing.public_key_path`);
    }
    const identity = requireRecord(fixture.identity, `Repro fixture ${fixtureId} identity`);
    requireNonEmptyString(identity.tenant_id, `Repro fixture ${fixtureId} identity.tenant_id`);
    requireNonEmptyString(
      identity.hmac_secret_dev_only_test_vector,
      `Repro fixture ${fixtureId} identity.hmac_secret_dev_only_test_vector`
    );
    const paths = requireRecord(fixture.paths, `Repro fixture ${fixtureId} paths`);
    requireNonEmptyString(paths.receipt, `Repro fixture ${fixtureId} paths.receipt`);
  }
  return manifest;
}

function validateExpectedDigests(value, fixtures) {
  const expected = requireRecord(value, "Expected-digests artifact");
  if (expected.schema_version !== EXPECTED_DIGESTS_SCHEMA_VERSION) {
    throw new TypeError(`Expected-digests schema_version must be ${EXPECTED_DIGESTS_SCHEMA_VERSION}.`);
  }
  const entries = requireRecord(expected.fixtures, "Expected-digests fixtures");
  for (const fixture of fixtures) {
    const entry = requireRecord(entries[fixture.fixture_id], `Expected digests for ${fixture.fixture_id}`);
    requireNonEmptyString(entry.receipt_id, `Expected receipt_id for ${fixture.fixture_id}`);
    requireNonEmptyString(entry.digest_sha256, `Expected digest_sha256 for ${fixture.fixture_id}`);
  }
  return expected;
}

function validateCorpusManifest(value, fixtureMap) {
  const manifest = requireRecord(value, "Corpus manifest");
  if (manifest.schema_version !== CORPUS_SCHEMA_VERSION) {
    throw new TypeError(`Corpus manifest schema_version must be ${CORPUS_SCHEMA_VERSION}.`);
  }
  requireNonEmptyString(manifest.repro_manifest_path, "Corpus manifest repro_manifest_path");
  if (!Array.isArray(manifest.attacks) || manifest.attacks.length === 0) {
    throw new TypeError("Corpus manifest attacks must be a non-empty array.");
  }

  const attackIds = new Set();
  for (const [index, valueAtIndex] of manifest.attacks.entries()) {
    const attack = requireRecord(valueAtIndex, `Corpus attack ${index}`);
    const attackId = requireNonEmptyString(attack.attack_id, `Corpus attack ${index} attack_id`);
    if (attackIds.has(attackId)) {
      throw new TypeError(`Corpus manifest contains duplicate attack_id ${attackId}.`);
    }
    attackIds.add(attackId);
    const fixtureId = requireNonEmptyString(attack.base_fixture_id, `Corpus attack ${attackId} base_fixture_id`);
    if (!fixtureMap.has(fixtureId)) {
      throw new TypeError(`Corpus attack ${attackId} names unknown base_fixture_id ${fixtureId}.`);
    }
    if (!["hmac", "hmac_with_expected_tenant", "kms_public_key"].includes(attack.verifier)) {
      throw new TypeError(`Corpus attack ${attackId} has unsupported verifier mode.`);
    }
    const fixture = fixtureMap.get(fixtureId);
    const expectedVerifier = fixture.signature_alg === HMAC_ALGORITHM ? "hmac" : "kms_public_key";
    if (attack.verifier !== expectedVerifier && !(expectedVerifier === "hmac" && attack.verifier === "hmac_with_expected_tenant")) {
      throw new TypeError(`Corpus attack ${attackId} verifier mode does not match its base fixture.`);
    }
    if (attack.fixture_kind !== undefined && attack.fixture_kind !== "receipt" && attack.fixture_kind !== "malformed-json") {
      throw new TypeError(`Corpus attack ${attackId} has unsupported fixture_kind.`);
    }
    requireNonEmptyString(attack.receipt_path, `Corpus attack ${attackId} receipt_path`);
    if (attack.expected_verdict !== "reject" && attack.expected_verdict !== "reject_by_consumer_tenant_expectation") {
      throw new TypeError(`Corpus attack ${attackId} must declare a rejection verdict.`);
    }
    requireNonEmptyString(attack.expected_rejection_phase, `Corpus attack ${attackId} expected_rejection_phase`);
    if (attack.expected_error_substring !== null && typeof attack.expected_error_substring !== "string") {
      throw new TypeError(`Corpus attack ${attackId} expected_error_substring must be a string or null.`);
    }
    if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
      requireNonEmptyString(attack.expected_tenant_id, `Corpus attack ${attackId} expected_tenant_id`);
      if (attack.verifier !== "hmac_with_expected_tenant") {
        throw new TypeError(`Corpus attack ${attackId} tenant-expectation verdict requires hmac_with_expected_tenant.`);
      }
    } else if (attack.verifier === "hmac_with_expected_tenant") {
      throw new TypeError(`Corpus attack ${attackId} hmac_with_expected_tenant requires a tenant-expectation verdict.`);
    }
  }
  return manifest;
}

function localFailureReport(name, detail) {
  return {
    verdict: "FAIL",
    checks: [{ name, passed: false, detail }]
  };
}

function readReceipt(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return { report: localFailureReport("artifact", "Receipt artifact could not be read.") };
  }
  try {
    return { receipt: JSON.parse(source) };
  } catch {
    return { report: localFailureReport("load", "Receipt artifact is not valid JSON.") };
  }
}

function verificationOptions(fixture, reproBaseDir, tenant) {
  const options = {
    expectedKeyId: fixture.signing.key_id
  };
  if (fixture.signature_alg === HMAC_ALGORITHM) {
    options.hmacSecret = fixture.signing.hmac_secret_dev_only_test_vector;
  } else {
    try {
      options.publicKeyPem = readFileSync(resolve(reproBaseDir, fixture.signing.public_key_path), "utf8");
    } catch {
      return { report: localFailureReport("artifact", "Public-key artifact could not be read.") };
    }
  }
  if (tenant !== undefined) {
    options.tenant = tenant;
    options.identityHmacSecret = fixture.identity.hmac_secret_dev_only_test_vector;
  }
  return { options };
}

function verifyArtifact(receiptPath, fixture, reproBaseDir, tenant) {
  const loaded = readReceipt(receiptPath);
  if (loaded.report) {
    return loaded.report;
  }
  const configured = verificationOptions(fixture, reproBaseDir, tenant);
  if (configured.report) {
    return configured.report;
  }
  try {
    return verifyReceipt(loaded.receipt, configured.options);
  } catch {
    return localFailureReport("internal", "Standalone verifier failed closed on an unexpected local error.");
  }
}

function reproCase(fixture, expected, reproBaseDir) {
  const report = verifyArtifact(
    resolve(reproBaseDir, fixture.paths.receipt),
    fixture,
    reproBaseDir,
    fixture.identity.tenant_id
  );
  const observedReceiptId = report.recomputed?.receipt_id ?? null;
  const observedDigest = report.recomputed?.digest_sha256 ?? null;
  const mismatches = [];
  if (report.verdict !== "PASS") {
    mismatches.push("unexpected_rejection");
  }
  if (observedReceiptId !== expected.receipt_id) {
    mismatches.push("receipt_id_mismatch");
  }
  if (observedDigest !== expected.digest_sha256) {
    mismatches.push("digest_sha256_mismatch");
  }
  return {
    fixture_id: fixture.fixture_id,
    expected_verdict: "PASS",
    observed_verdict: report.verdict,
    expected_receipt_id: expected.receipt_id,
    observed_receipt_id: observedReceiptId,
    expected_digest_sha256: expected.digest_sha256,
    observed_digest_sha256: observedDigest,
    matched: mismatches.length === 0,
    mismatches
  };
}

function corpusCase(attack, fixture, corpusBaseDir, reproBaseDir) {
  const expectedTenant =
    attack.expected_verdict === "reject_by_consumer_tenant_expectation" ? attack.expected_tenant_id : undefined;
  const report = verifyArtifact(resolve(corpusBaseDir, attack.receipt_path), fixture, reproBaseDir, expectedTenant);
  const failedChecks = report.checks
    .filter((entry) => !entry.passed)
    .map((entry) => ({ name: entry.name, detail: entry.detail }));
  const expectedCheck = failedChecks.find((entry) => entry.name === attack.expected_rejection_phase);
  const phaseMatched = expectedCheck !== undefined;
  const detailMatched =
    attack.expected_error_substring === null ||
    (expectedCheck !== undefined && expectedCheck.detail.includes(attack.expected_error_substring));
  const mismatches = [];
  if (report.verdict === "PASS") {
    mismatches.push("unexpected_acceptance");
  }
  if (!phaseMatched) {
    mismatches.push("rejection_phase_mismatch");
  }
  if (!detailMatched) {
    mismatches.push("rejection_detail_mismatch");
  }
  return {
    attack_id: attack.attack_id,
    expected_verdict: "FAIL",
    observed_verdict: report.verdict,
    expected_rejection_phase: attack.expected_rejection_phase,
    expected_error_substring: attack.expected_error_substring,
    observed_failed_checks: failedChecks,
    rejection_phase_matched: phaseMatched,
    rejection_detail_matched: detailMatched,
    matched: mismatches.length === 0,
    mismatches
  };
}

function emptySummary() {
  return {
    repro: {
      total: 0,
      matched: 0,
      unexpected_rejections: 0,
      commitment_mismatches: 0
    },
    corpus: {
      total: 0,
      matched: 0,
      unexpected_acceptances: 0,
      expectation_mismatches: 0
    }
  };
}

function summarize(reproCases, corpusCases) {
  return {
    repro: {
      total: reproCases.length,
      matched: reproCases.filter((entry) => entry.matched).length,
      unexpected_rejections: reproCases.filter((entry) => entry.observed_verdict !== "PASS").length,
      commitment_mismatches: reproCases.filter((entry) =>
        entry.mismatches.some((reason) => reason === "receipt_id_mismatch" || reason === "digest_sha256_mismatch")
      ).length
    },
    corpus: {
      total: corpusCases.length,
      matched: corpusCases.filter((entry) => entry.matched).length,
      unexpected_acceptances: corpusCases.filter((entry) => entry.observed_verdict === "PASS").length,
      expectation_mismatches: corpusCases.filter(
        (entry) => entry.observed_verdict === "FAIL" && (!entry.rejection_phase_matched || !entry.rejection_detail_matched)
      ).length
    }
  };
}

function reportBase(reproManifestPath, corpusManifestPath) {
  return {
    schema_version: REPLAY_REPORT_SCHEMA_VERSION,
    replay: "verifiers/node/replay_receipt_manifests.mjs",
    verifier: "verifiers/node/ghost_receipt_verify.mjs",
    manifests: {
      repro: displayPath(reproManifestPath),
      corpus: displayPath(corpusManifestPath)
    }
  };
}

export function replayManifests(options = {}) {
  const reproManifestPath = resolve(options.reproManifestPath ?? DEFAULT_REPRO_MANIFEST);
  const corpusManifestPath = resolve(options.corpusManifestPath ?? DEFAULT_CORPUS_MANIFEST);
  const base = reportBase(reproManifestPath, corpusManifestPath);

  try {
    const reproBaseDir = dirname(reproManifestPath);
    const corpusBaseDir = dirname(corpusManifestPath);
    const repro = validateReproManifest(readJsonArtifact(reproManifestPath, "Repro manifest"));
    const expectedPath = resolve(reproBaseDir, repro.expected_digests_path);
    const expected = validateExpectedDigests(
      readJsonArtifact(expectedPath, "Expected-digests artifact"),
      repro.fixtures
    );
    const fixtureMap = new Map(repro.fixtures.map((fixture) => [fixture.fixture_id, fixture]));
    const corpus = validateCorpusManifest(
      readJsonArtifact(corpusManifestPath, "Corpus manifest"),
      fixtureMap
    );
    const declaredReproPath = resolve(corpusBaseDir, corpus.repro_manifest_path);
    if (declaredReproPath !== reproManifestPath) {
      throw new TypeError("Corpus manifest repro_manifest_path does not identify the selected repro manifest.");
    }

    const reproCases = repro.fixtures.map((fixture) =>
      reproCase(fixture, expected.fixtures[fixture.fixture_id], reproBaseDir)
    );
    const corpusCases = corpus.attacks.map((attack) =>
      corpusCase(attack, fixtureMap.get(attack.base_fixture_id), corpusBaseDir, reproBaseDir)
    );
    const summary = summarize(reproCases, corpusCases);
    const passed = reproCases.every((entry) => entry.matched) && corpusCases.every((entry) => entry.matched);
    return {
      ...base,
      verdict: passed ? "PASS" : "FAIL",
      summary,
      repro_cases: reproCases,
      corpus_cases: corpusCases,
      errors: [],
      non_claim: NON_CLAIM
    };
  } catch (error) {
    return {
      ...base,
      verdict: "FAIL",
      summary: emptySummary(),
      repro_cases: [],
      corpus_cases: [],
      errors: [
        {
          code: "manifest_error",
          detail: error instanceof Error ? error.message : String(error)
        }
      ],
      non_claim: NON_CLAIM
    };
  }
}

function usage() {
  return `Standalone Ghost-Ark receipt-manifest replay (local files only)\n\nUsage:\n  node verifiers/node/replay_receipt_manifests.mjs [options]\n\nOptions:\n  --repro-manifest <path>  Repro manifest (default: ${DEFAULT_REPRO_MANIFEST}).\n  --corpus-manifest <path> Malicious-corpus manifest (default: ${DEFAULT_CORPUS_MANIFEST}).\n  --help                   Show this help.\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`Missing value for ${arg}.`);
    }
    if (arg === "--repro-manifest") {
      options.reproManifestPath = value;
    } else if (arg === "--corpus-manifest") {
      options.corpusManifestPath = value;
    } else {
      throw new TypeError(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  return options;
}

export function runCli(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const reproManifestPath = resolve(DEFAULT_REPRO_MANIFEST);
    const corpusManifestPath = resolve(DEFAULT_CORPUS_MANIFEST);
    const report = {
      ...reportBase(reproManifestPath, corpusManifestPath),
      verdict: "FAIL",
      summary: emptySummary(),
      repro_cases: [],
      corpus_cases: [],
      errors: [
        {
          code: "arguments_error",
          detail: error instanceof Error ? error.message : String(error)
        }
      ],
      non_claim: NON_CLAIM
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  const report = replayManifests(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.verdict === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
