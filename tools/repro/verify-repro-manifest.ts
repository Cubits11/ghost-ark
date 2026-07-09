/**
 * Verify the committed receipt reproducibility fixtures against the manifest:
 * recompute receipt_id and digestSha256, decode the signature envelope strictly,
 * verify the envelope digest binding, verify signatures (dev-only HMAC or
 * RSA-PSS public key), and compare everything against expected-digests.json.
 *
 * Runs fully offline. Requires no AWS credentials and performs no AWS calls.
 *
 * Claim boundary: a PASS verdict proves internal receipt consistency under
 * Ghost-Ark verifier rules. It does not prove model safety, semantic truth,
 * compliance, or runtime integrity. The KMS-style fixture is a local simulation
 * of the KMS RSASSA_PSS_SHA_256 algorithm path and is NOT AWS KMS evidence.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { sha256Hex } from "../../packages/receipt-schema/src/hashCanonicalization";
import {
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  receiptIdFromUnsignedDecisionReceipt,
  signedDecisionReceiptHash,
  unsignedReceiptForSigning
} from "../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import {
  DecisionReceiptSignatureEnvelope,
  LocalDevHmacReceiptSigner,
  decodeDecisionReceiptSignatureEnvelope
} from "../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";
import { DecisionReceiptCanonicalVerifier, verifyDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/verifier";
import {
  ExpectedDigests,
  FixtureReport,
  REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION,
  REPRO_REPORT_SCHEMA_VERSION,
  ReproFixture,
  ReproReport,
  ReportCheck,
  loadReproManifest,
  readJson
} from "./manifest";

interface CliOptions {
  manifestPath: string;
  outPath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { manifestPath: "examples/reproducibility/manifest.json", outPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = argv[++index] ?? options.manifestPath;
    } else if (arg === "--out") {
      options.outPath = argv[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function checkOf(name: string, passed: boolean, detail: string): ReportCheck {
  return { name, passed, detail };
}

function buildFixtureVerifier(fixture: ReproFixture, baseDir: string): DecisionReceiptCanonicalVerifier {
  if (fixture.signature_alg === "LOCAL_HMAC_SHA256_DEV_ONLY") {
    const secret = fixture.signing.hmac_secret_dev_only_test_vector;
    if (!secret) {
      throw new Error(`Fixture ${fixture.fixture_id} is missing its dev-only HMAC test vector.`);
    }
    return new LocalDevHmacReceiptSigner({ secret, keyId: fixture.signing.key_id });
  }

  const publicKeyPath = fixture.signing.public_key_path;
  if (!publicKeyPath) {
    throw new Error(`Fixture ${fixture.fixture_id} is missing signing.public_key_path.`);
  }
  return new KmsDecisionReceiptVerifier({
    keyId: fixture.signing.key_id,
    publicKeyPem: readFileSync(join(baseDir, publicKeyPath), "utf8")
  });
}

async function verifyFixture(
  fixture: ReproFixture,
  baseDir: string,
  expected: ExpectedDigests
): Promise<FixtureReport> {
  const checks: ReportCheck[] = [];

  let signed: SignedDecisionReceipt;
  try {
    signed = validateSignedDecisionReceipt(readJson<unknown>(join(baseDir, fixture.paths.receipt)));
    checks.push(checkOf("schema", true, "Committed receipt matches ghost.receipt.v1 schema."));
  } catch (error) {
    checks.push(checkOf("schema", false, error instanceof Error ? error.message : String(error)));
    return { fixture_id: fixture.fixture_id, verdict: "FAIL", checks };
  }

  const identity = fixture.identity;
  const identityMatches =
    privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.tenant_id) === signed.tenant_id_hash &&
    privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.user_id) === signed.user_id_hash &&
    privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.session_id) === signed.session_id_hash;
  checks.push(
    checkOf(
      "identity_hashes",
      identityMatches,
      identityMatches
        ? "tenant/user/session hashes recompute from manifest-declared identity test vectors."
        : "Identity hashes do not recompute from manifest-declared identity test vectors."
    )
  );

  const unsigned = unsignedReceiptForSigning(signed);
  const { receipt_id: _receiptId, ...withoutId } = unsigned;
  const recomputedReceiptId = receiptIdFromUnsignedDecisionReceipt(withoutId);
  checks.push(
    checkOf(
      "receipt_id_recomputed",
      recomputedReceiptId === signed.receipt_id,
      recomputedReceiptId === signed.receipt_id
        ? "receipt_id recomputes from the canonical unsigned receipt."
        : `receipt_id mismatch. Recomputed ${recomputedReceiptId}; committed ${signed.receipt_id}.`
    )
  );

  const recomputedDigest = decisionReceiptDigest(signed);
  const canonicalPayload = canonicalUnsignedDecisionReceipt(signed);
  const committedCanonical = readFileSync(join(baseDir, fixture.paths.canonical_payload), "utf8");
  checks.push(
    checkOf(
      "canonical_payload_committed",
      committedCanonical === canonicalPayload && sha256Hex(committedCanonical) === recomputedDigest,
      committedCanonical === canonicalPayload
        ? "Committed canonical payload matches the recomputed canonical unsigned receipt, and its SHA-256 equals digestSha256."
        : "Committed canonical payload does not match the recomputed canonical unsigned receipt."
    )
  );

  let envelope: DecisionReceiptSignatureEnvelope | null = null;
  try {
    envelope = decodeDecisionReceiptSignatureEnvelope(signed.receipt_signature);
    checks.push(checkOf("envelope_strict_decode", true, "Signature envelope decodes under strict envelope rules."));
  } catch (error) {
    checks.push(checkOf("envelope_strict_decode", false, error instanceof Error ? error.message : String(error)));
  }

  if (envelope) {
    const committedEnvelope = readJson<DecisionReceiptSignatureEnvelope>(join(baseDir, fixture.paths.signature_envelope));
    const envelopeMatches =
      committedEnvelope.schemaVersion === envelope.schemaVersion &&
      committedEnvelope.keyId === envelope.keyId &&
      committedEnvelope.algorithm === envelope.algorithm &&
      committedEnvelope.digestSha256 === envelope.digestSha256 &&
      committedEnvelope.signature === envelope.signature;
    checks.push(
      checkOf(
        "envelope_committed",
        envelopeMatches,
        envelopeMatches
          ? "Decoded envelope matches the committed envelope artifact."
          : "Decoded envelope does not match the committed envelope artifact."
      )
    );
    checks.push(
      checkOf(
        "envelope_digest_binding",
        envelope.digestSha256 === recomputedDigest,
        envelope.digestSha256 === recomputedDigest
          ? "Envelope digestSha256 equals the recomputed canonical unsigned receipt digest."
          : `Envelope digest mismatch. Envelope ${envelope.digestSha256}; recomputed ${recomputedDigest}.`
      )
    );
  }

  const verifier = buildFixtureVerifier(fixture, baseDir);
  const verification = await verifyDecisionReceipt(signed, verifier);
  checks.push(
    checkOf(
      "library_verification",
      verification.verdict,
      verification.verdict
        ? "verifyDecisionReceipt returns a passing verdict for the committed receipt."
        : `verifyDecisionReceipt failed: ${verification.checks
            .filter((entry) => !entry.passed)
            .map((entry) => `${entry.name}: ${entry.detail}`)
            .join(" | ")}`
    )
  );

  const expectations = expected.fixtures[fixture.fixture_id];
  if (!expectations) {
    checks.push(checkOf("expected_digests", false, `No expected digests recorded for ${fixture.fixture_id}.`));
  } else {
    const digestsMatch =
      expectations.receipt_id === signed.receipt_id &&
      expectations.digest_sha256 === recomputedDigest &&
      expectations.signed_receipt_hash === signedDecisionReceiptHash(signed);
    checks.push(
      checkOf(
        "expected_digests",
        digestsMatch,
        digestsMatch
          ? "receipt_id, digestSha256, and signed receipt hash match expected-digests.json."
          : "Committed receipt digests drifted from expected-digests.json."
      )
    );
  }

  return {
    fixture_id: fixture.fixture_id,
    verdict: checks.every((entry) => entry.passed) ? "PASS" : "FAIL",
    checks
  };
}

export async function verifyReproManifest(manifestPath: string): Promise<ReproReport> {
  const { manifest, baseDir } = loadReproManifest(manifestPath);
  const expected = readJson<ExpectedDigests>(join(baseDir, manifest.expected_digests_path));
  if (expected.schema_version !== REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION) {
    throw new Error(`Unsupported expected-digests schema_version: ${String(expected.schema_version)}`);
  }

  const fixtures: FixtureReport[] = [];
  for (const fixture of manifest.fixtures) {
    fixtures.push(await verifyFixture(fixture, baseDir, expected));
  }

  return {
    schema_version: REPRO_REPORT_SCHEMA_VERSION,
    manifest_path: manifestPath,
    verdict: fixtures.every((entry) => entry.verdict === "PASS") ? "PASS" : "FAIL",
    fixture_count: fixtures.length,
    fixtures,
    non_claim:
      "A PASS verdict proves internal receipt consistency under Ghost-Ark verifier rules. It does not prove model safety, semantic truth, compliance, or runtime integrity."
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const report = await verifyReproManifest(options.manifestPath);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outPath) {
    writeFileSync(options.outPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
  return report.verdict === "PASS" ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Repro manifest verification failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
