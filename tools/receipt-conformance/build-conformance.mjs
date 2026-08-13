#!/usr/bin/env node

/**
 * Build the receipt-conformance artifact from the repository's source-of-truth
 * manifests. This script is the ONLY authoring path for `conformance.json` and
 * `fixtures/` — the shipped files are generated, never hand-edited, so a case
 * cannot silently drift from the corpus manifest that pre-registered it.
 *
 * The GENERATED artifact is usable with zero Ghost-Ark code (fixtures +
 * conformance.json + run-conformance.mjs + SPEC.md). This BUILD script is
 * repository-side tooling and may read repository files; that does not leak
 * into the artifact, and `tests/unit/conformance/conformanceArtifact.test.ts`
 * asserts the committed artifact is byte-identical to a fresh generation.
 *
 * Usage: node tools/receipt-conformance/build-conformance.mjs [--check]
 *   --check  regenerate in memory and exit 1 on any difference from the
 *            committed artifact, changing nothing on disk.
 */

import { createHash, createHmac } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_DIR = HERE;
const FIXTURES_DIR = join(OUT_DIR, "fixtures");

const REPRO_DIR = join(REPO_ROOT, "examples/reproducibility");
const CORPUS_DIR = join(REPO_ROOT, "examples/malicious-receipts");
const PSS_DIR = join(REPRO_DIR, "pss-digest-mode");

const PSS_MODE_MESSAGE = "digest-as-message";
const PSS_MODE_MHASH = "digest-as-mhash";

const NON_CLAIM =
  "Passing this conformance suite establishes that a verifier reaches the declared verdicts on these " +
  "fixtures under the declared options. It does not establish that the verifier is correct on inputs " +
  "outside the suite, that the specification itself is free of misreadings, that any receipt is true, " +
  "or anything about model safety, compliance, or AWS behaviour. The suite NARROWS the independent-" +
  "implementation gap (EXPERIMENTS.md open gap #10) by making it externally closable; it does not close it.";

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  console.error(`build-conformance: ${message}`);
  process.exit(1);
}

const repro = readJson(join(REPRO_DIR, "manifest.json"));
const corpus = readJson(join(CORPUS_DIR, "manifest.json"));
const expectedDigests = readJson(join(REPRO_DIR, "expected-digests.json"));
const pssManifest = readJson(join(PSS_DIR, "manifest.json"));

const reproById = new Map(repro.fixtures.map((fixture) => [fixture.fixture_id, fixture]));

// ---------------------------------------------------------------------------
// Source-consistency assertions. The build REFUSES to emit an artifact whose
// vectors disagree with the committed canonical payloads — a conformance suite
// generated from inconsistent sources would certify the inconsistency.
// ---------------------------------------------------------------------------

for (const fixture of repro.fixtures) {
  const canonicalBytes = readFileSync(join(REPRO_DIR, fixture.paths.canonical_payload));
  const digest = sha256Hex(canonicalBytes);
  const expected = expectedDigests.fixtures[fixture.fixture_id];
  if (!expected) {
    fail(`no expected digest recorded for fixture ${fixture.fixture_id}`);
  }
  if (digest !== expected.digest_sha256) {
    fail(
      `canonical payload for ${fixture.fixture_id} hashes to ${digest}, ` +
        `but expected-digests.json records ${expected.digest_sha256}`
    );
  }
}

// The tenant commitment vector must reproduce the committed tenant_id_hash.
const identitySecret = repro.fixtures[0].identity.hmac_secret_dev_only_test_vector;
const tenantId = repro.fixtures[0].identity.tenant_id;
const baselineReceipt = readJson(join(REPRO_DIR, repro.fixtures[0].paths.receipt));
const tenantCommitment = `hmac-sha256:${createHmac("sha256", identitySecret).update(tenantId).digest("hex")}`;
if (tenantCommitment !== baselineReceipt.tenant_id_hash) {
  fail("tenant commitment vector does not reproduce the committed tenant_id_hash");
}

// The PSS digest-mode receipt must share its body with kms-style-rsa: same
// receipt_id, different envelope. That is what makes the pair a treatment
// vector rather than two unrelated receipts.
const pssReceipt = readJson(join(PSS_DIR, pssManifest.files.receipt));
const rsaExpected = expectedDigests.fixtures["kms-style-rsa"];
if (pssReceipt.receipt_id !== rsaExpected.receipt_id) {
  fail("pss-digest-mode receipt does not share the kms-style-rsa receipt identity");
}
const pssEnvelope = JSON.parse(
  Buffer.from(pssReceipt.receipt_signature, "base64url").toString("utf8")
);

// ---------------------------------------------------------------------------
// Fixture tree. Copies, never rewrites: byte identity with the source files is
// asserted by tests/unit/conformance/conformanceArtifact.test.ts.
// ---------------------------------------------------------------------------

const COPIES = [
  ...repro.fixtures.map((fixture) => ({
    from: join(REPRO_DIR, fixture.paths.receipt),
    to: join("receipts", `${fixture.fixture_id}.receipt.json`)
  })),
  ...corpus.attacks.map((attack) => ({
    from: join(CORPUS_DIR, attack.receipt_path),
    to: join("receipts", attack.receipt_path.split("/").pop())
  })),
  { from: join(PSS_DIR, pssManifest.files.receipt), to: join("receipts", "kms-digest-mode.receipt.json") },
  { from: join(REPRO_DIR, "keys/kms-style-public-key.pem"), to: join("keys", "kms-style-public-key.pem") },
  { from: join(PSS_DIR, pssManifest.files.public_key), to: join("keys", "pss-digest-mode-public-key.pem") },
  ...repro.fixtures.map((fixture) => ({
    from: join(REPRO_DIR, fixture.paths.canonical_payload),
    to: join("canonical-payloads", `${fixture.fixture_id}.canonical.json`)
  }))
];

// ---------------------------------------------------------------------------
// Case table.
// ---------------------------------------------------------------------------

function hmacArgs(base) {
  return [
    "--hmac-secret",
    base.signing.hmac_secret_dev_only_test_vector,
    "--expected-key-id",
    base.signing.key_id
  ];
}

const cases = [];

for (const fixture of repro.fixtures) {
  const receiptPath = `fixtures/receipts/${fixture.fixture_id}.receipt.json`;
  const expected = expectedDigests.fixtures[fixture.fixture_id];
  const args = ["--receipt", receiptPath];
  if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
    args.push(
      "--key",
      "fixtures/keys/kms-style-public-key.pem",
      "--expected-key-id",
      fixture.signing.key_id,
      "--pss-mode",
      PSS_MODE_MESSAGE
    );
  } else {
    args.push(...hmacArgs(fixture));
  }
  cases.push({
    case_id: `valid-${fixture.fixture_id}`,
    description: fixture.description,
    args,
    expected_verdict: "PASS",
    expected_failing_checks: null,
    expected_recomputed: {
      receipt_id: expected.receipt_id,
      digest_sha256: expected.digest_sha256
    }
  });
}

// The two PSS treatments as SEPARATE vectors, each asserted in both
// directions: the treatment a signature was produced under must accept, and
// the other treatment must reject. A verifier that conflates the treatments
// fails two of these four cases; one that hardcodes either treatment fails one.
const rsaFixture = reproById.get("kms-style-rsa");
cases.push({
  case_id: "pss-kms-style-rsa-wrong-treatment",
  description:
    "The kms-style-rsa signature was produced under digest-as-message; it must NOT verify under digest-as-mhash.",
  args: [
    "--receipt",
    "fixtures/receipts/kms-style-rsa.receipt.json",
    "--key",
    "fixtures/keys/kms-style-public-key.pem",
    "--expected-key-id",
    rsaFixture.signing.key_id,
    "--pss-mode",
    PSS_MODE_MHASH
  ],
  expected_verdict: "FAIL",
  expected_failing_checks: ["signature"],
  expected_recomputed: null
});
cases.push({
  case_id: "valid-kms-digest-mode",
  description:
    "Same receipt body as kms-style-rsa, signature produced with OpenSSL over the precomputed digest " +
    "(AWS KMS MessageType=DIGEST semantics); verifies under digest-as-mhash only.",
  args: [
    "--receipt",
    "fixtures/receipts/kms-digest-mode.receipt.json",
    "--key",
    "fixtures/keys/pss-digest-mode-public-key.pem",
    "--expected-key-id",
    pssEnvelope.keyId,
    "--pss-mode",
    PSS_MODE_MHASH
  ],
  expected_verdict: "PASS",
  expected_failing_checks: null,
  expected_recomputed: {
    receipt_id: rsaExpected.receipt_id,
    digest_sha256: rsaExpected.digest_sha256
  }
});
cases.push({
  case_id: "pss-kms-digest-mode-wrong-treatment",
  description: "The kms-digest-mode signature must NOT verify under digest-as-message.",
  args: [
    "--receipt",
    "fixtures/receipts/kms-digest-mode.receipt.json",
    "--key",
    "fixtures/keys/pss-digest-mode-public-key.pem",
    "--expected-key-id",
    pssEnvelope.keyId,
    "--pss-mode",
    PSS_MODE_MESSAGE
  ],
  expected_verdict: "FAIL",
  expected_failing_checks: ["signature"],
  expected_recomputed: null
});

for (const attack of corpus.attacks) {
  const base = reproById.get(attack.base_fixture_id);
  if (!base) {
    fail(`corpus attack ${attack.attack_id} references unknown base fixture ${attack.base_fixture_id}`);
  }
  const receiptPath = `fixtures/receipts/${attack.receipt_path.split("/").pop()}`;
  const args = ["--receipt", receiptPath];
  if (attack.verifier === "kms_public_key") {
    args.push(
      "--key",
      "fixtures/keys/kms-style-public-key.pem",
      "--expected-key-id",
      base.signing.key_id,
      "--pss-mode",
      PSS_MODE_MESSAGE
    );
  } else {
    args.push(...hmacArgs(base));
  }
  if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
    args.push("--tenant", attack.expected_tenant_id, "--identity-hmac-secret", identitySecret);
  }

  const accepts = attack.expected_verdict === "accept_documented_boundary";
  // A parse failure has no single mandated check name: the reference reports
  // it as `load`; an implementation whose schema layer subsumes loading may
  // report `schema`. Both satisfy the contract; SPEC.md §9 records this.
  const failingChecks = accepts
    ? null
    : attack.expected_rejection_phase === "load"
      ? ["load", "schema"]
      : [attack.expected_rejection_phase];

  cases.push({
    case_id: attack.attack_id,
    description: attack.mutation_description,
    args,
    expected_verdict: accepts ? "PASS" : "FAIL",
    expected_failing_checks: failingChecks,
    claim_boundary: attack.claim_boundary,
    expected_recomputed: null
  });
}

// ---------------------------------------------------------------------------
// Contract document.
// ---------------------------------------------------------------------------

const contract = {
  schema_version: "ghost.receipt_conformance.v1",
  suite_version: "0.1.0",
  spec: "SPEC.md",
  generated_by: "tools/receipt-conformance/build-conformance.mjs",
  adapter_contract: {
    description:
      "A candidate verifier is any executable invoked as: <command...> <case args>. It must exit 0 to " +
      "accept and non-zero to reject. It SHOULD print a JSON report to stdout containing a `checks` " +
      "array of {name, passed} objects and, on acceptance, a `recomputed` object with `receipt_id` and " +
      "`digest_sha256`; when it does, the harness additionally scores failing-check and identity " +
      "conformance. Paths in case args are relative to the directory containing this file.",
    options: [
      "--receipt <path>",
      "--key <path>",
      "--hmac-secret <published dev-only test vector>",
      "--expected-key-id <key id>",
      "--tenant <tenant id>",
      "--identity-hmac-secret <published dev-only test vector>",
      "--pss-mode <digest-as-message|digest-as-mhash>"
    ]
  },
  check_vocabulary: {
    ordered: [
      "configuration",
      "load",
      "schema",
      "canonical_payload",
      "receipt_id",
      "envelope",
      "key_id",
      "digest",
      "signature",
      "tenant_expectation"
    ],
    note:
      "SPEC.md defines each check and the short-circuit rules. `expected_failing_checks` lists the " +
      "acceptable check names for a rejection: at least one of them must be reported failed."
  },
  levels: {
    verdict: "REQUIRED. The exit-code verdict matches expected_verdict on every case.",
    "failing-check":
      "Evaluated when the candidate emits a parseable JSON `checks` array: on every expected-FAIL case, " +
      "at least one expected failing check is reported failed.",
    identity:
      "Evaluated when the candidate emits `recomputed`: on cases carrying expected_recomputed, the " +
      "recomputed receipt_id and digest_sha256 match byte-for-byte."
  },
  canonical_vectors: {
    description:
      "Implement the canonicalizer first and self-check it against these before touching cryptography: " +
      "sha256(canonical_payload file bytes) must equal digest_sha256, and " +
      "'grct_' + sha256(canonicalize(payload minus receipt_id)) must equal receipt_id.",
    fixtures: repro.fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      canonical_payload_path: `fixtures/canonical-payloads/${fixture.fixture_id}.canonical.json`,
      digest_sha256: expectedDigests.fixtures[fixture.fixture_id].digest_sha256,
      receipt_id: expectedDigests.fixtures[fixture.fixture_id].receipt_id
    })),
    tenant_commitment: {
      description:
        "tenant_id_hash = 'hmac-sha256:' + hex(HMAC-SHA-256(identity_secret, tenant_id)). Both inputs are " +
        "published dev-only test vectors, not credentials.",
      identity_hmac_secret_dev_only_test_vector: identitySecret,
      tenant_id: tenantId,
      expected_tenant_id_hash: tenantCommitment
    }
  },
  secrets_note:
    "Every secret in this file is a published dev-only test vector recorded in the Ghost-Ark repository " +
    "since 2026-07-09. None is a credential; local HMAC signing is dev-only and never a production mode.",
  cases,
  non_claim: NON_CLAIM
};

// ---------------------------------------------------------------------------
// Emit (or --check).
// ---------------------------------------------------------------------------

const contractJson = `${JSON.stringify(contract, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let dirty = [];
  const committed = existsSync(join(OUT_DIR, "conformance.json"))
    ? readFileSync(join(OUT_DIR, "conformance.json"), "utf8")
    : null;
  if (committed !== contractJson) {
    dirty.push("conformance.json");
  }
  for (const copy of COPIES) {
    const target = join(FIXTURES_DIR, copy.to);
    if (!existsSync(target) || !readFileSync(copy.from).equals(readFileSync(target))) {
      dirty.push(`fixtures/${copy.to}`);
    }
  }
  if (dirty.length > 0) {
    console.error(`build-conformance --check: artifact differs from a fresh generation: ${dirty.join(", ")}`);
    process.exit(1);
  }
  console.log("build-conformance --check: artifact matches a fresh generation.");
  process.exit(0);
}

rmSync(FIXTURES_DIR, { recursive: true, force: true });
for (const sub of ["receipts", "keys", "canonical-payloads"]) {
  mkdirSync(join(FIXTURES_DIR, sub), { recursive: true });
}
for (const copy of COPIES) {
  cpSync(copy.from, join(FIXTURES_DIR, copy.to));
}
writeFileSync(join(OUT_DIR, "conformance.json"), contractJson);
console.log(
  `build-conformance: wrote conformance.json (${cases.length} cases) and ${COPIES.length} fixture files.`
);
