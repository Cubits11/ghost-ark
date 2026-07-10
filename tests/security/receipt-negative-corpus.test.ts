import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { privateHmacDigest } from "../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { validateSignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";
import { DecisionReceiptCanonicalVerifier, verifyDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/verifier";
import {
  CorpusAttack,
  fixtureById,
  loadCorpusManifest,
  loadReproManifest
} from "../../tools/repro/manifest";

const CORPUS_MANIFEST_PATH = "examples/malicious-receipts/manifest.json";

const { manifest: corpus, baseDir: corpusBaseDir } = loadCorpusManifest(CORPUS_MANIFEST_PATH);
const { manifest: repro, baseDir: reproBaseDir } = loadReproManifest(join(corpusBaseDir, corpus.repro_manifest_path));

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function verifierForAttack(attack: CorpusAttack): DecisionReceiptCanonicalVerifier {
  const baseFixture = fixtureById(repro, attack.base_fixture_id);

  if (attack.verifier === "kms_public_key") {
    const publicKeyPath = baseFixture.signing.public_key_path;
    if (!publicKeyPath) {
      throw new Error(`Base fixture ${baseFixture.fixture_id} has no public key path.`);
    }
    return new KmsDecisionReceiptVerifier({
      keyId: baseFixture.signing.key_id,
      publicKeyPem: readFileSync(join(reproBaseDir, publicKeyPath), "utf8")
    });
  }

  const secret = baseFixture.signing.hmac_secret_dev_only_test_vector;
  if (!secret) {
    throw new Error(`Base fixture ${baseFixture.fixture_id} has no dev-only HMAC test vector.`);
  }
  return new LocalDevHmacReceiptSigner({ secret, keyId: baseFixture.signing.key_id });
}

describe("malicious decision receipt corpus", () => {
  it("covers the full mission attack surface with unique attack ids", () => {
    expect(corpus.attacks.length).toBeGreaterThanOrEqual(18);
    const ids = corpus.attacks.map((attack) => attack.attack_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accepts every untampered base fixture (corpus baseline sanity)", async () => {
    for (const fixture of repro.fixtures) {
      const receipt = readJsonFile(join(reproBaseDir, fixture.paths.receipt));
      const verifier = verifierForAttack({
        base_fixture_id: fixture.fixture_id,
        verifier: fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256" ? "kms_public_key" : "hmac"
      } as CorpusAttack);
      const result = await verifyDecisionReceipt(receipt, verifier);
      expect(
        result.verdict,
        `${fixture.fixture_id}: ${result.checks
          .filter((check) => !check.passed)
          .map((check) => `${check.name}: ${check.detail}`)
          .join(" | ")}`
      ).toBe(true);
    }
  });

  for (const attack of corpus.attacks.filter((entry) => entry.fixture_kind === "malformed-json")) {
    it(`rejects ${attack.attack_id} (${attack.attack_name}) at JSON parse time`, () => {
      expect(
        () => readJsonFile(join(corpusBaseDir, attack.receipt_path)),
        `${attack.attack_id} must not parse as JSON`
      ).toThrow();
    });
  }

  for (const attack of corpus.attacks.filter(
    (entry) => entry.expected_verdict === "reject" && entry.fixture_kind !== "malformed-json"
  )) {
    it(`fails closed on ${attack.attack_id} (${attack.attack_name})`, async () => {
      const mutant = readJsonFile(join(corpusBaseDir, attack.receipt_path));
      const result = await verifyDecisionReceipt(mutant, verifierForAttack(attack));

      expect(result.verdict, `${attack.attack_id} must never verify`).toBe(false);

      const failingPhase = result.checks.find((check) => check.name === attack.expected_rejection_phase);
      expect(failingPhase, `${attack.attack_id}: expected a "${attack.expected_rejection_phase}" check to be recorded`).toBeDefined();
      expect(
        failingPhase?.passed,
        `${attack.attack_id}: expected the "${attack.expected_rejection_phase}" check to fail; detail: ${failingPhase?.detail}`
      ).toBe(false);

      if (attack.expected_error_substring) {
        expect(failingPhase?.detail).toContain(attack.expected_error_substring);
      }
    });
  }

  it("rejects a cryptographically valid cross-tenant receipt at the consumer tenant-expectation boundary (MAL-014)", async () => {
    const attack = corpus.attacks.find((entry) => entry.attack_name === "cross-tenant-verifier-mismatch");
    expect(attack).toBeDefined();
    if (!attack || !attack.expected_tenant_id) {
      throw new Error("MAL-014 must declare expected_tenant_id.");
    }

    const receipt = validateSignedDecisionReceipt(readJsonFile(join(corpusBaseDir, attack.receipt_path)));
    const verification = await verifyDecisionReceipt(receipt, verifierForAttack(attack));

    // Documented boundary: the library verifier alone passes, because the
    // receipt is genuinely valid for tenant-repro-a. Tenant expectations are a
    // consumer-side check on tenant_id_hash.
    expect(verification.verdict).toBe(true);

    const baseFixture = fixtureById(repro, attack.base_fixture_id);
    const expectedTenantHash = privateHmacDigest(
      baseFixture.identity.hmac_secret_dev_only_test_vector,
      attack.expected_tenant_id
    );
    expect(receipt.tenant_id_hash).not.toBe(expectedTenantHash);

    // The consumer acceptance rule: cryptographic verdict AND tenant binding.
    const acceptedByExpectedTenantConsumer = verification.verdict && receipt.tenant_id_hash === expectedTenantHash;
    expect(acceptedByExpectedTenantConsumer, "a tenant-B consumer must reject a tenant-A receipt").toBe(false);
  });

  it("never accepts any corpus mutant end-to-end under its consumer rule", async () => {
    for (const attack of corpus.attacks) {
      if (attack.fixture_kind === "malformed-json") {
        expect(
          () => readJsonFile(join(corpusBaseDir, attack.receipt_path)),
          `${attack.attack_id} must be rejected at JSON parse time`
        ).toThrow();
        continue;
      }
      const mutant = readJsonFile(join(corpusBaseDir, attack.receipt_path));
      const result = await verifyDecisionReceipt(mutant, verifierForAttack(attack));

      let accepted: boolean;
      if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
        const baseFixture = fixtureById(repro, attack.base_fixture_id);
        const expectedTenantHash = privateHmacDigest(
          baseFixture.identity.hmac_secret_dev_only_test_vector,
          attack.expected_tenant_id ?? ""
        );
        const tenantHash = (mutant as { tenant_id_hash?: string }).tenant_id_hash;
        accepted = result.verdict && tenantHash === expectedTenantHash;
      } else {
        accepted = result.verdict;
      }

      expect(accepted, `${attack.attack_id} (${attack.attack_name}) was accepted — malicious receipt admitted silently`).toBe(false);
    }
  });

  it("carries the corpus non-claim", () => {
    expect(corpus.non_claim).toContain("does not prove resistance to all attacks");
  });
});
