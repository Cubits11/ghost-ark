/**
 * Differential and adversarial tests for the standalone Node verifier.
 *
 * The verifier process imports Node built-ins only. This test is allowed to
 * call the production verifier separately so that agreement is asserted
 * without coupling the standalone implementation to production code.
 */
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  privateHmacDigest,
  receiptIdFromUnsignedDecisionReceipt
} from "../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { DecisionReceiptCanonicalVerifier, verifyDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/verifier";

const repoRoot = process.cwd();
const verifierPath = join(repoRoot, "verifiers/node/ghost_receipt_verify.mjs");
const corpusManifestPath = join(repoRoot, "examples/malicious-receipts/manifest.json");
const corpusBaseDir = dirname(corpusManifestPath);

interface ReproFixture {
  fixture_id: string;
  signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" | "KMS_SIGN_RSASSA_PSS_SHA_256";
  signing: {
    key_id: string;
    hmac_secret_dev_only_test_vector?: string;
    public_key_path?: string;
  };
  identity: {
    hmac_secret_dev_only_test_vector: string;
    tenant_id: string;
  };
  paths: { receipt: string };
}

interface ReproManifest {
  schema_version: string;
  expected_digests_path: string;
  fixtures: ReproFixture[];
}

interface CorpusAttack {
  attack_id: string;
  attack_name: string;
  base_fixture_id: string;
  verifier: "hmac" | "kms_public_key" | "hmac_with_expected_tenant";
  fixture_kind?: "receipt" | "malformed-json";
  receipt_path: string;
  expected_verdict: "reject" | "reject_by_consumer_tenant_expectation";
  expected_rejection_phase: string;
  expected_error_substring: string | null;
  expected_tenant_id?: string;
}

interface CorpusManifest {
  schema_version: string;
  repro_manifest_path: string;
  attacks: CorpusAttack[];
}

interface VerifierReport {
  schema_version: string;
  verifier: string;
  verdict: "PASS" | "FAIL";
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  non_claim: string;
  recomputed?: { receipt_id: string; digest_sha256: string };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const corpus = readJson<CorpusManifest>(corpusManifestPath);
const reproManifestPath = resolve(corpusBaseDir, corpus.repro_manifest_path);
const reproBaseDir = dirname(reproManifestPath);
const repro = readJson<ReproManifest>(reproManifestPath);
const expectedDigests = readJson<{
  fixtures: Record<string, { receipt_id: string; digest_sha256: string }>;
}>(join(reproBaseDir, repro.expected_digests_path));

function fixtureById(fixtureId: string): ReproFixture {
  const fixture = repro.fixtures.find((entry) => entry.fixture_id === fixtureId);
  if (!fixture) {
    throw new Error(`Unknown fixture id ${fixtureId}.`);
  }
  return fixture;
}

function runVerifier(args: string[]): { status: number | null; report: VerifierReport; stderr: string } {
  const result = spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  expect(result.error, `standalone verifier process error: ${String(result.error)}`).toBeUndefined();
  expect(result.stdout, `standalone verifier emitted no report; stderr: ${result.stderr}`).not.toBe("");
  return {
    status: result.status,
    report: JSON.parse(result.stdout) as VerifierReport,
    stderr: result.stderr
  };
}

function standaloneArgsForFixture(fixture: ReproFixture, receiptPath: string): string[] {
  const args = ["--receipt", receiptPath, "--expected-key-id", fixture.signing.key_id];
  if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
    args.push("--key", join(reproBaseDir, fixture.signing.public_key_path ?? ""));
  } else {
    args.push("--hmac-secret", fixture.signing.hmac_secret_dev_only_test_vector ?? "");
  }
  return args;
}

function standaloneArgsForAttack(attack: CorpusAttack): string[] {
  const fixture = fixtureById(attack.base_fixture_id);
  const args = standaloneArgsForFixture(fixture, join(corpusBaseDir, attack.receipt_path));
  if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
    args.push(
      "--tenant",
      attack.expected_tenant_id ?? "",
      "--identity-hmac-secret",
      fixture.identity.hmac_secret_dev_only_test_vector
    );
  }
  return args;
}

function productionVerifierForAttack(attack: CorpusAttack): DecisionReceiptCanonicalVerifier {
  const fixture = fixtureById(attack.base_fixture_id);
  if (attack.verifier === "kms_public_key") {
    return new KmsDecisionReceiptVerifier({
      keyId: fixture.signing.key_id,
      publicKeyPem: readFileSync(join(reproBaseDir, fixture.signing.public_key_path ?? ""), "utf8")
    });
  }
  return new LocalDevHmacReceiptSigner({
    keyId: fixture.signing.key_id,
    secret: fixture.signing.hmac_secret_dev_only_test_vector ?? ""
  });
}

describe("standalone Node receipt verifier", () => {
  it("imports Node built-ins only and has no production-package dependency", () => {
    const source = readFileSync(verifierPath, "utf8");
    const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map((match) => match[1]);

    expect(importSpecifiers.length).toBeGreaterThan(0);
    expect(importSpecifiers.every((specifier) => specifier.startsWith("node:"))).toBe(true);
    expect(source).not.toMatch(/packages\/|enforcement-runtime|receipt-schema\/src|tools\/ghost-verify/u);
  });

  it("accepts all reproducibility fixtures and agrees with their committed receipt ids and digests", () => {
    for (const fixture of repro.fixtures) {
      const args = standaloneArgsForFixture(fixture, join(reproBaseDir, fixture.paths.receipt));
      args.push(
        "--tenant",
        fixture.identity.tenant_id,
        "--identity-hmac-secret",
        fixture.identity.hmac_secret_dev_only_test_vector
      );
      const run = runVerifier(args);
      const expected = expectedDigests.fixtures[fixture.fixture_id];

      expect(run.status, `${fixture.fixture_id}: ${JSON.stringify(run.report.checks)}`).toBe(0);
      expect(run.report.verdict).toBe("PASS");
      expect(run.stderr).toContain("VERDICT: PASS");
      expect(run.report.recomputed?.receipt_id).toBe(expected.receipt_id);
      expect(run.report.recomputed?.digest_sha256).toBe(expected.digest_sha256);
      expect(run.report.checks.find((entry) => entry.name === "tenant_expectation")?.passed).toBe(true);
    }
  });

  it("replays the manifest and rejects every adversarial corpus case at its declared boundary", () => {
    expect(corpus.schema_version).toBe("ghost.malicious_receipt_corpus.v1");
    expect(corpus.attacks.length).toBeGreaterThanOrEqual(26);

    for (const attack of corpus.attacks) {
      const run = runVerifier(standaloneArgsForAttack(attack));
      const failingCheck = run.report.checks.find((entry) => entry.name === attack.expected_rejection_phase);

      expect(run.status, `${attack.attack_id} must exit nonzero`).not.toBe(0);
      expect(run.report.verdict, `${attack.attack_id} must fail closed`).toBe("FAIL");
      expect(run.stderr).toContain("VERDICT: FAIL");
      expect(failingCheck, `${attack.attack_id} must record ${attack.expected_rejection_phase}`).toBeDefined();
      expect(failingCheck?.passed, `${attack.attack_id}: ${failingCheck?.detail}`).toBe(false);
      if (attack.expected_error_substring) {
        expect(failingCheck?.detail).toContain(attack.expected_error_substring);
      }
    }
  });

  it("agrees with the production verifier's end-to-end acceptance decision for every corpus case", async () => {
    for (const attack of corpus.attacks) {
      const standaloneAccepted = runVerifier(standaloneArgsForAttack(attack)).report.verdict === "PASS";
      let productionAccepted = false;

      if (attack.fixture_kind !== "malformed-json") {
        const receipt = readJson<Record<string, unknown>>(join(corpusBaseDir, attack.receipt_path));
        const verification = await verifyDecisionReceipt(receipt, productionVerifierForAttack(attack));
        productionAccepted = verification.verdict;
        if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
          const fixture = fixtureById(attack.base_fixture_id);
          const expectedTenantHash = privateHmacDigest(
            fixture.identity.hmac_secret_dev_only_test_vector,
            attack.expected_tenant_id ?? ""
          );
          productionAccepted = productionAccepted && receipt.tenant_id_hash === expectedTenantHash;
        }
      }

      expect(standaloneAccepted, `${attack.attack_id}: standalone verifier accepted the mutant`).toBe(false);
      expect(productionAccepted, `${attack.attack_id}: production verifier accepted the mutant`).toBe(false);
      expect(standaloneAccepted, `${attack.attack_id}: verifier implementations disagree`).toBe(productionAccepted);
    }
  });

  it("recomputes the same Unicode-sensitive receipt identity as the production canonicalizer", () => {
    const attack = corpus.attacks.find((entry) => entry.attack_name === "unicode-canonicalization-ambiguity");
    expect(attack).toBeDefined();
    if (!attack) {
      return;
    }

    const receipt = readJson<Record<string, unknown>>(join(corpusBaseDir, attack.receipt_path));
    const { receipt_signature: _signature, receipt_id: _receiptId, ...withoutId } = receipt;
    const productionReceiptId = receiptIdFromUnsignedDecisionReceipt(withoutId as never);
    const standalone = runVerifier(standaloneArgsForAttack(attack));

    expect(standalone.report.recomputed?.receipt_id).toBe(productionReceiptId);
  });

  it("distinguishes local digest-as-message signatures from AWS KMS DIGEST-mode signatures", () => {
    const receipt = "examples/reproducibility/pss-digest-mode/kms-digest-mode.receipt.json";
    const key = "examples/reproducibility/pss-digest-mode/public-key.pem";
    const keyId = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-0000000000bb";
    const base = ["--receipt", receipt, "--key", key, "--expected-key-id", keyId];

    const kmsDigestMode = runVerifier([...base, "--pss-mode", "digest-as-mhash"]);
    expect(kmsDigestMode.status, JSON.stringify(kmsDigestMode.report.checks)).toBe(0);
    expect(kmsDigestMode.report.verdict).toBe("PASS");

    const localMode = runVerifier(base);
    expect(localMode.status).not.toBe(0);
    expect(localMode.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);
  });

  it("verifies the legacy sample receipt and rejects a wrong tenant or wrong key", () => {
    const base = [
      "--receipt",
      "examples/sample-receipts/valid-receipt.json",
      "--key",
      "examples/sample-receipts/public-key.pem"
    ];
    const valid = runVerifier([...base, "--tenant", "acme-lab"]);
    expect(valid.status, JSON.stringify(valid.report.checks)).toBe(0);
    expect(valid.report.verdict).toBe("PASS");

    const wrongTenant = runVerifier([...base, "--tenant", "other-lab"]);
    expect(wrongTenant.status).not.toBe(0);
    expect(wrongTenant.report.checks.find((entry) => entry.name === "tenant")?.passed).toBe(false);

    const wrongKey = runVerifier([
      "--receipt",
      "examples/reproducibility/receipts/kms-style-rsa.receipt.json",
      "--key",
      "examples/sample-receipts/public-key.pem"
    ]);
    expect(wrongKey.status).not.toBe(0);
    expect(wrongKey.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);
  });

  it("fails closed when signature-verification material is omitted", () => {
    const hmac = runVerifier([
      "--receipt",
      "examples/reproducibility/receipts/hmac-baseline.receipt.json"
    ]);
    expect(hmac.status).not.toBe(0);
    expect(hmac.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);

    const rsa = runVerifier([
      "--receipt",
      "examples/reproducibility/receipts/kms-style-rsa.receipt.json"
    ]);
    expect(rsa.status).not.toBe(0);
    expect(rsa.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);
    expect(rsa.report.non_claim).toContain("does not prove model safety");
  });
});
