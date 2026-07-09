/**
 * Rebuild (or drift-check) the decision receipt reproducibility fixtures and
 * the malicious receipt corpus from manifest-declared inputs.
 *
 * Modes:
 *   --check (default)      Regenerate deterministically in memory and fail if any
 *                          committed fixture byte or expected digest drifted.
 *   --write                Rewrite regenerable fixtures, corpus mutants, and
 *                          expected-digests.json.
 *   --refresh-kms-style    With --write: regenerate the KMS-style RSA fixture with
 *                          a fresh throwaway local keypair (private key discarded).
 *                          receipt_id and digest_sha256 stay stable; only the
 *                          signature bytes and public key change.
 *
 * Claim boundary: this tool proves that committed fixtures are reproducible from
 * declared inputs under Ghost-Ark canonicalization and signing rules. It does not
 * prove model safety, semantic truth, compliance, or runtime integrity. The
 * KMS-style fixture is a local simulation of the KMS RSASSA_PSS_SHA_256 algorithm
 * path and is NOT AWS KMS evidence.
 */
import { constants, createHash, generateKeyPairSync, sign as signDigest, verify as verifyDigest } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { canonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import {
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  signedDecisionReceiptHash
} from "../../packages/enforcement-runtime/src/receipts/canonical";
import {
  DecisionReceiptSignatureEnvelope,
  LocalDevHmacReceiptSigner,
  decodeDecisionReceiptSignatureEnvelope,
  signDecisionReceipt
} from "../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";
import {
  CorpusAttack,
  ExpectedDigests,
  REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION,
  ReproFixture,
  ReportCheck,
  fixtureFileJson,
  flipHexAt,
  loadCorpusManifest,
  loadReproManifest,
  readJson,
  rebuildUnsignedReceipt
} from "./manifest";

interface CliOptions {
  manifestPath: string;
  corpusPath: string;
  write: boolean;
  refreshKmsStyle: boolean;
}

interface FixtureArtifacts {
  signed: SignedDecisionReceipt;
  canonicalPayload: string;
  envelope: DecisionReceiptSignatureEnvelope;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: "examples/reproducibility/manifest.json",
    corpusPath: "examples/malicious-receipts/manifest.json",
    write: false,
    refreshKmsStyle: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = argv[++index] ?? options.manifestPath;
    } else if (arg === "--corpus") {
      options.corpusPath = argv[++index] ?? options.corpusPath;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--check") {
      options.write = false;
    } else if (arg === "--refresh-kms-style") {
      options.refreshKmsStyle = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function decodeEnvelopeFromReceipt(signed: SignedDecisionReceipt): DecisionReceiptSignatureEnvelope {
  return decodeDecisionReceiptSignatureEnvelope(signed.receipt_signature);
}

function encodeEnvelopeObject(envelope: Record<string, unknown>): string {
  return Buffer.from(canonicalize(envelope), "utf8").toString("base64url");
}

function parseEnvelopeObject(signed: SignedDecisionReceipt): Record<string, unknown> {
  return JSON.parse(Buffer.from(signed.receipt_signature, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Deterministic single-field mutations for the malicious corpus. Each function
 * receives a structured clone of the base signed receipt and returns the mutant
 * object (which may be schema-invalid on purpose).
 */
const attackMutations: Record<string, (base: SignedDecisionReceipt) => unknown> = {
  "altered-receipt-id": (base) => ({
    ...base,
    receipt_id: flipHexAt(base.receipt_id, "grct_", 63)
  }),
  "altered-envelope-digest": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.digestSha256 = flipHexAt(String(envelope.digestSha256), "", 0);
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "altered-signature": (base) => {
    const envelope = parseEnvelopeObject(base);
    const signatureBytes = Buffer.from(String(envelope.signature), "base64");
    signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 0x01;
    envelope.signature = signatureBytes.toString("base64");
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "altered-key-id": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.keyId = `${String(envelope.keyId)}-tampered`;
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "kms-alias-key-id": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.keyId = "arn:aws:kms:us-east-1:111122223333:alias/ghost-ark-decision-receipts";
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "signature-alg-mismatch": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.algorithm =
      envelope.algorithm === "LOCAL_HMAC_SHA256_DEV_ONLY" ? "KMS_SIGN_RSASSA_PSS_SHA_256" : "LOCAL_HMAC_SHA256_DEV_ONLY";
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "envelope-schema-version-mutation": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.schemaVersion = "ghost.decision_receipt_signature.v0";
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "envelope-extra-field": (base) => {
    const envelope = parseEnvelopeObject(base);
    envelope.attacker_note = "smuggled";
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "envelope-missing-field": (base) => {
    const envelope = parseEnvelopeObject(base);
    delete envelope.keyId;
    return { ...base, receipt_signature: encodeEnvelopeObject(envelope) };
  },
  "envelope-standard-base64": (base) => {
    const envelope = parseEnvelopeObject(base);
    const standardBase64 = Buffer.from(canonicalize(envelope), "utf8").toString("base64");
    if (standardBase64 === base.receipt_signature || /^[A-Za-z0-9_-]+$/u.test(standardBase64)) {
      throw new Error(
        "envelope-standard-base64 mutation did not produce a non-base64url encoding; adjust the base fixture so padding or +/ characters appear."
      );
    }
    return { ...base, receipt_signature: standardBase64 };
  },
  "malformed-base64url-envelope": (base) => ({
    ...base,
    receipt_signature: "!!!not-base64url!!!"
  }),
  "prev-receipt-hash-mutation": (base) => {
    if (base.prev_receipt_hash === null) {
      throw new Error("prev-receipt-hash-mutation requires a chained base fixture.");
    }
    return { ...base, prev_receipt_hash: flipHexAt(base.prev_receipt_hash, "sha256:", 0) };
  },
  "tenant-id-hash-mutation": (base) => ({
    ...base,
    tenant_id_hash: flipHexAt(base.tenant_id_hash, "hmac-sha256:", 0)
  }),
  "cross-tenant-verifier-mismatch": (base) => ({ ...base }),
  "action-taken-multiplicity": (base) => ({
    ...base,
    action_taken: [base.action_taken[0] ?? "emit_receipt", ...base.action_taken]
  }),
  "input-digest-mutation": (base) => ({
    ...base,
    input_digest: flipHexAt(base.input_digest, "sha256:", 0)
  }),
  "retrieved-context-digests-mutation": (base) => ({
    ...base,
    retrieved_context_digests: base.retrieved_context_digests.slice(0, -1)
  })
};

function buildMutant(
  attack: CorpusAttack,
  baseReceipts: Map<string, SignedDecisionReceipt>
): unknown {
  const base = baseReceipts.get(attack.base_fixture_id);
  if (!base) {
    throw new Error(`Corpus attack ${attack.attack_id} references unknown base fixture ${attack.base_fixture_id}.`);
  }

  if (attack.attack_name === "wrong-canonical-payload-signature") {
    const donor = baseReceipts.get("hmac-chained");
    if (!donor) {
      throw new Error("wrong-canonical-payload-signature requires the hmac-chained fixture as signature donor.");
    }
    return { ...structuredClone(base), receipt_signature: donor.receipt_signature };
  }

  const mutate = attackMutations[attack.attack_name];
  if (!mutate) {
    throw new Error(`No mutation implementation for attack_name ${attack.attack_name}.`);
  }
  return mutate(structuredClone(base));
}

function rebuildHmacFixture(
  fixture: ReproFixture,
  resolveSignedFixture: (fixtureId: string) => SignedDecisionReceipt
): FixtureArtifacts {
  const secret = fixture.signing.hmac_secret_dev_only_test_vector;
  if (!secret) {
    throw new Error(`Fixture ${fixture.fixture_id} is missing its dev-only HMAC test vector.`);
  }
  const unsigned = rebuildUnsignedReceipt(fixture, resolveSignedFixture);
  const signer = new LocalDevHmacReceiptSigner({ secret, keyId: fixture.signing.key_id });
  const signed = signDecisionReceipt(unsigned, signer);
  return {
    signed,
    canonicalPayload: canonicalUnsignedDecisionReceipt(signed),
    envelope: decodeEnvelopeFromReceipt(signed)
  };
}

function refreshKmsStyleFixture(
  fixture: ReproFixture,
  baseDir: string,
  resolveSignedFixture: (fixtureId: string) => SignedDecisionReceipt
): FixtureArtifacts {
  const publicKeyPath = fixture.signing.public_key_path;
  if (!publicKeyPath) {
    throw new Error(`Fixture ${fixture.fixture_id} is missing signing.public_key_path.`);
  }

  const unsigned = rebuildUnsignedReceipt(fixture, resolveSignedFixture);
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signer = {
    keyId: fixture.signing.key_id,
    algorithm: "KMS_SIGN_RSASSA_PSS_SHA_256" as const,
    signCanonical: (canonicalPayload: string): string =>
      signDigest(null, createHash("sha256").update(canonicalPayload).digest(), {
        key: pair.privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      }).toString("base64")
  };
  const signed = signDecisionReceipt(unsigned, signer);

  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  writeFileArtifact(join(baseDir, publicKeyPath), publicKeyPem);
  // The private key object is discarded when this function returns; it is never
  // serialized or written anywhere.

  return {
    signed,
    canonicalPayload: canonicalUnsignedDecisionReceipt(signed),
    envelope: decodeEnvelopeFromReceipt(signed)
  };
}

function verifyCommittedKmsStyleFixture(
  fixture: ReproFixture,
  baseDir: string,
  resolveSignedFixture: (fixtureId: string) => SignedDecisionReceipt,
  checks: ReportCheck[]
): FixtureArtifacts {
  const receiptPath = join(baseDir, fixture.paths.receipt);
  if (!existsSync(receiptPath)) {
    throw new Error(
      `Committed KMS-style fixture ${fixture.fixture_id} not found at ${receiptPath}. Run with --write --refresh-kms-style to generate it.`
    );
  }
  const signed = validateSignedDecisionReceipt(readJson<unknown>(receiptPath));
  const unsigned = rebuildUnsignedReceipt(fixture, resolveSignedFixture);
  const rebuiltCanonical = canonicalUnsignedDecisionReceipt(unsigned);
  const committedCanonical = canonicalUnsignedDecisionReceipt(signed);
  checks.push({
    name: `${fixture.fixture_id}:canonical_payload_rebuild`,
    passed: rebuiltCanonical === committedCanonical,
    detail:
      rebuiltCanonical === committedCanonical
        ? "Canonical unsigned payload rebuilt from manifest inputs matches the committed receipt."
        : "Canonical unsigned payload rebuilt from manifest inputs does not match the committed receipt."
  });

  const envelope = decodeEnvelopeFromReceipt(signed);
  const publicKeyPath = fixture.signing.public_key_path;
  if (!publicKeyPath) {
    throw new Error(`Fixture ${fixture.fixture_id} is missing signing.public_key_path.`);
  }
  const publicKeyPem = readFileSync(join(baseDir, publicKeyPath), "utf8");
  const signatureValid = verifyDigest(
    null,
    createHash("sha256").update(committedCanonical).digest(),
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
    Buffer.from(envelope.signature, "base64")
  );
  checks.push({
    name: `${fixture.fixture_id}:rsa_signature`,
    passed: signatureValid,
    detail: signatureValid
      ? "Committed RSA-PSS signature verifies against the committed public key."
      : "Committed RSA-PSS signature does not verify against the committed public key."
  });

  return { signed, canonicalPayload: committedCanonical, envelope };
}

function writeFileArtifact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function compareFileArtifact(path: string, expectedContent: string, name: string, checks: ReportCheck[]): void {
  if (!existsSync(path)) {
    checks.push({ name, passed: false, detail: `Missing committed artifact ${path}.` });
    return;
  }
  const committed = readFileSync(path, "utf8");
  checks.push({
    name,
    passed: committed === expectedContent,
    detail: committed === expectedContent ? "Committed artifact matches deterministic rebuild." : `Drift detected in ${path}.`
  });
}

function emitOrCheckArtifact(write: boolean, path: string, content: string, name: string, checks: ReportCheck[]): void {
  if (write) {
    writeFileArtifact(path, content);
    checks.push({ name, passed: true, detail: `Wrote ${path}.` });
  } else {
    compareFileArtifact(path, content, name, checks);
  }
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const { manifest, baseDir } = loadReproManifest(options.manifestPath);
  const checks: ReportCheck[] = [];

  const artifacts = new Map<string, FixtureArtifacts>();
  const resolveSignedFixture = (fixtureId: string): SignedDecisionReceipt => {
    const entry = artifacts.get(fixtureId);
    if (!entry) {
      throw new Error(`Fixture ${fixtureId} must be declared before fixtures that chain to it.`);
    }
    return entry.signed;
  };

  for (const fixture of manifest.fixtures) {
    let built: FixtureArtifacts;
    if (fixture.signature_alg === "LOCAL_HMAC_SHA256_DEV_ONLY") {
      built = rebuildHmacFixture(fixture, resolveSignedFixture);
    } else if (options.write && options.refreshKmsStyle) {
      built = refreshKmsStyleFixture(fixture, baseDir, resolveSignedFixture);
    } else {
      built = verifyCommittedKmsStyleFixture(fixture, baseDir, resolveSignedFixture, checks);
    }
    artifacts.set(fixture.fixture_id, built);

    const regenerated = fixture.signature_alg === "LOCAL_HMAC_SHA256_DEV_ONLY" || (options.write && options.refreshKmsStyle);
    if (regenerated) {
      emitOrCheckArtifact(
        options.write,
        join(baseDir, fixture.paths.receipt),
        fixtureFileJson(built.signed),
        `${fixture.fixture_id}:receipt`,
        checks
      );
    }
    emitOrCheckArtifact(
      options.write,
      join(baseDir, fixture.paths.canonical_payload),
      built.canonicalPayload,
      `${fixture.fixture_id}:canonical_payload`,
      checks
    );
    emitOrCheckArtifact(
      options.write,
      join(baseDir, fixture.paths.signature_envelope),
      fixtureFileJson(built.envelope),
      `${fixture.fixture_id}:signature_envelope`,
      checks
    );
  }

  const expectedDigests: ExpectedDigests = {
    schema_version: REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION,
    fixtures: Object.fromEntries(
      manifest.fixtures.map((fixture) => {
        const built = artifacts.get(fixture.fixture_id);
        if (!built) {
          throw new Error(`Missing artifacts for fixture ${fixture.fixture_id}.`);
        }
        return [
          fixture.fixture_id,
          {
            receipt_id: built.signed.receipt_id,
            digest_sha256: decisionReceiptDigest(built.signed),
            signed_receipt_hash: signedDecisionReceiptHash(built.signed)
          }
        ];
      })
    )
  };
  emitOrCheckArtifact(
    options.write,
    join(baseDir, manifest.expected_digests_path),
    fixtureFileJson(expectedDigests),
    "expected_digests",
    checks
  );

  const { manifest: corpus, baseDir: corpusBaseDir } = loadCorpusManifest(options.corpusPath);
  const baseReceipts = new Map<string, SignedDecisionReceipt>(
    [...artifacts.entries()].map(([fixtureId, entry]) => [fixtureId, entry.signed])
  );
  for (const attack of corpus.attacks) {
    const mutant = buildMutant(attack, baseReceipts);
    emitOrCheckArtifact(
      options.write,
      join(corpusBaseDir, attack.receipt_path),
      fixtureFileJson(mutant),
      `corpus:${attack.attack_id}:${attack.attack_name}`,
      checks
    );
  }

  const verdict = checks.every((entry) => entry.passed) ? "PASS" : "FAIL";
  const report = {
    schema_version: "ghost.repro_rebuild_report.v1",
    mode: options.write ? "write" : "check",
    manifest_path: options.manifestPath,
    corpus_path: options.corpusPath,
    verdict,
    checks,
    non_claim:
      "Fixture reproducibility proves internal receipt consistency under Ghost-Ark verifier rules. It does not prove model safety, semantic truth, compliance, or runtime integrity."
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return verdict === "PASS" ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`Receipt fixture rebuild failed closed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { attackMutations, buildMutant, main, parseArgs };
