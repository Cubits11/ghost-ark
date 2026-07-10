/**
 * Differential verification: the independent Python verifier
 * (verifiers/python/ghost_receipt_verify.py, stdlib-only, no Ghost-Ark
 * TypeScript imports, no AWS) must agree with the TypeScript verifier across
 * the full reproducibility fixture set and the full malicious receipt corpus.
 *
 * Claim boundary: agreement proves that two independent implementations apply
 * the same verification rules to these fixtures. It does not prove the rules
 * are complete, does not prove resistance to all attacks, and does not prove
 * model safety, compliance, or AWS-live behavior.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { privateHmacDigest, receiptIdFromUnsignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { DecisionReceiptCanonicalVerifier, verifyDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/verifier";
import { CorpusAttack, fixtureById, loadCorpusManifest, loadReproManifest } from "../../tools/repro/manifest";

const repoRoot = process.cwd();
const pythonVerifier = join(repoRoot, "verifiers/python/ghost_receipt_verify.py");
const CORPUS_MANIFEST_PATH = "examples/malicious-receipts/manifest.json";
const IDENTITY_SECRET_DEV_ONLY = "ghost-ark-repro-identity-dev-only-test-vector-v1";

const { manifest: corpus, baseDir: corpusBaseDir } = loadCorpusManifest(CORPUS_MANIFEST_PATH);
const { manifest: repro, baseDir: reproBaseDir } = loadReproManifest(join(corpusBaseDir, corpus.repro_manifest_path));
const expectedDigests = JSON.parse(readFileSync(join(reproBaseDir, repro.expected_digests_path), "utf8")) as {
  fixtures: Record<string, { receipt_id: string; digest_sha256: string }>;
};

interface PythonReport {
  schema_version: string;
  verdict: "PASS" | "FAIL";
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  recomputed?: { receipt_id: string; digest_sha256: string };
  non_claim: string;
}

interface PythonRun {
  status: number | null;
  report: PythonReport;
  stderr: string;
}

function hasPython3(): boolean {
  return spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
}

const pythonAvailable = hasPython3();

function runPython(args: string[]): PythonRun {
  const result = spawnSync("python3", [pythonVerifier, ...args], { cwd: repoRoot, encoding: "utf8" });
  expect(result.stdout, `python verifier produced no stdout; stderr: ${result.stderr}`).not.toBe("");
  return { status: result.status, report: JSON.parse(result.stdout) as PythonReport, stderr: result.stderr };
}

function pythonArgsForAttack(attack: CorpusAttack): string[] {
  const base = fixtureById(repro, attack.base_fixture_id);
  const args = ["--receipt", join(corpusBaseDir, attack.receipt_path)];
  if (attack.verifier === "kms_public_key") {
    args.push("--key", join(reproBaseDir, base.signing.public_key_path ?? ""), "--expected-key-id", base.signing.key_id);
  } else {
    args.push(
      "--hmac-secret",
      base.signing.hmac_secret_dev_only_test_vector ?? "",
      "--expected-key-id",
      base.signing.key_id
    );
  }
  if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
    args.push("--tenant", attack.expected_tenant_id ?? "", "--identity-hmac-secret", IDENTITY_SECRET_DEV_ONLY);
  }
  return args;
}

function nodeVerifierForAttack(attack: CorpusAttack): DecisionReceiptCanonicalVerifier {
  const base = fixtureById(repro, attack.base_fixture_id);
  if (attack.verifier === "kms_public_key") {
    return new KmsDecisionReceiptVerifier({
      keyId: base.signing.key_id,
      publicKeyPem: readFileSync(join(reproBaseDir, base.signing.public_key_path ?? ""), "utf8")
    });
  }
  return new LocalDevHmacReceiptSigner({
    secret: base.signing.hmac_secret_dev_only_test_vector ?? "",
    keyId: base.signing.key_id
  });
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("independent Python verifier — full corpus differential", () => {
  it("accepts every untampered repro fixture and recomputes the expected digests", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    for (const fixture of repro.fixtures) {
      const args = ["--receipt", join(reproBaseDir, fixture.paths.receipt), "--expected-key-id", fixture.signing.key_id];
      if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
        args.push("--key", join(reproBaseDir, fixture.signing.public_key_path ?? ""));
      } else {
        args.push("--hmac-secret", fixture.signing.hmac_secret_dev_only_test_vector ?? "");
      }
      const run = runPython(args);
      expect(run.status, `${fixture.fixture_id}: ${JSON.stringify(run.report.checks)}`).toBe(0);
      expect(run.report.verdict).toBe("PASS");
      expect(run.stderr).toContain("VERDICT: PASS");
      const expected = expectedDigests.fixtures[fixture.fixture_id];
      expect(run.report.recomputed?.receipt_id).toBe(expected.receipt_id);
      expect(run.report.recomputed?.digest_sha256).toBe(expected.digest_sha256);
    }
  });

  it("fails closed on every applicable malicious fixture at the manifest-declared phase", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    for (const attack of corpus.attacks) {
      const run = runPython(pythonArgsForAttack(attack));
      expect(run.status, `${attack.attack_id} must exit nonzero`).not.toBe(0);
      expect(run.report.verdict, `${attack.attack_id} must report FAIL`).toBe("FAIL");
      expect(run.stderr).toContain("VERDICT: FAIL");
      const failingPhases = run.report.checks.filter((entry) => !entry.passed).map((entry) => entry.name);
      expect(
        failingPhases,
        `${attack.attack_id}: expected failing phase ${attack.expected_rejection_phase}; failing: ${failingPhases.join(", ")}`
      ).toContain(attack.expected_rejection_phase === "tenant_expectation" ? "tenant_expectation" : attack.expected_rejection_phase);
    }
  });

  it("agrees with the TypeScript verifier on acceptance for every corpus fixture", async () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    for (const attack of corpus.attacks) {
      const pythonAccepted = runPython(pythonArgsForAttack(attack)).report.verdict === "PASS";

      let nodeAccepted: boolean;
      if (attack.fixture_kind === "malformed-json") {
        let parsed = false;
        try {
          readJsonFile(join(corpusBaseDir, attack.receipt_path));
          parsed = true;
        } catch {
          parsed = false;
        }
        nodeAccepted = parsed;
      } else {
        const mutant = readJsonFile(join(corpusBaseDir, attack.receipt_path));
        const result = await verifyDecisionReceipt(mutant, nodeVerifierForAttack(attack));
        if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
          const base = fixtureById(repro, attack.base_fixture_id);
          const expectedTenantHash = privateHmacDigest(
            base.identity.hmac_secret_dev_only_test_vector,
            attack.expected_tenant_id ?? ""
          );
          nodeAccepted = result.verdict && (mutant as { tenant_id_hash?: string }).tenant_id_hash === expectedTenantHash;
        } else {
          nodeAccepted = result.verdict;
        }
      }

      expect(pythonAccepted, `${attack.attack_id}: python accepted a fixture the corpus expects to reject`).toBe(false);
      expect(nodeAccepted, `${attack.attack_id}: node accepted a fixture the corpus expects to reject`).toBe(false);
      expect(pythonAccepted).toBe(nodeAccepted);
    }
  });

  it("recomputes the identical receipt id across languages for the non-ASCII fixture (MAL-022)", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const attack = corpus.attacks.find((entry) => entry.attack_name === "unicode-canonicalization-ambiguity");
    expect(attack).toBeDefined();
    if (!attack) {
      return;
    }
    const mutant = readJsonFile(join(corpusBaseDir, attack.receipt_path)) as Record<string, unknown>;
    const { receipt_signature: _sig, receipt_id: _id, ...withoutId } = mutant;
    const nodeRecomputedId = receiptIdFromUnsignedDecisionReceipt(withoutId as never);
    const run = runPython(pythonArgsForAttack(attack));
    expect(run.report.recomputed?.receipt_id, "Node and Python canonicalization must agree on non-ASCII bytes").toBe(
      nodeRecomputedId
    );
  });

  it("verifies the KMS digest-mode vector only under --pss-mode digest-as-mhash", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const receipt = "examples/reproducibility/pss-digest-mode/kms-digest-mode.receipt.json";
    const key = "examples/reproducibility/pss-digest-mode/public-key.pem";
    const keyId = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-0000000000bb";

    const mhashRun = runPython(["--receipt", receipt, "--key", key, "--pss-mode", "digest-as-mhash", "--expected-key-id", keyId]);
    expect(mhashRun.status, JSON.stringify(mhashRun.report.checks)).toBe(0);
    expect(mhashRun.report.verdict).toBe("PASS");

    const defaultRun = runPython(["--receipt", receipt, "--key", key]);
    expect(defaultRun.status).not.toBe(0);
    expect(defaultRun.report.verdict).toBe("FAIL");
    expect(defaultRun.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);

    const wrongKeyRun = runPython([
      "--receipt",
      receipt,
      "--key",
      "examples/reproducibility/keys/kms-style-public-key.pem",
      "--pss-mode",
      "digest-as-mhash"
    ]);
    expect(wrongKeyRun.status).not.toBe(0);
    expect(wrongKeyRun.report.verdict).toBe("FAIL");
  });

  it("rejects the valid KMS-style receipt under the wrong public key", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const run = runPython([
      "--receipt",
      "examples/reproducibility/receipts/kms-style-rsa.receipt.json",
      "--key",
      "examples/sample-receipts/public-key.pem"
    ]);
    expect(run.status).not.toBe(0);
    expect(run.report.verdict).toBe("FAIL");
    expect(run.report.checks.find((entry) => entry.name === "signature")?.passed).toBe(false);
  });

  it("fails closed on a missing receipt file and on a malformed public key", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const missing = runPython(["--receipt", "examples/reproducibility/receipts/does-not-exist.receipt.json"]);
    expect(missing.status).not.toBe(0);
    expect(missing.report.verdict).toBe("FAIL");
    expect(missing.report.checks.find((entry) => entry.name === "load")?.passed).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "ghost-ark-python-verifier-"));
    const malformedKeyPath = join(dir, "malformed-key.pem");
    writeFileSync(malformedKeyPath, "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----\n");
    const badKey = runPython([
      "--receipt",
      "examples/reproducibility/receipts/kms-style-rsa.receipt.json",
      "--key",
      malformedKeyPath
    ]);
    expect(badKey.status).not.toBe(0);
    expect(badKey.report.verdict).toBe("FAIL");
    expect(badKey.report.checks.find((entry) => entry.name === "public_key")?.passed).toBe(false);
  });

  it("verifies the sample receipt record with a tenant expectation and rejects a wrong tenant", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const base = [
      "--receipt",
      "examples/sample-receipts/valid-receipt.json",
      "--key",
      "examples/sample-receipts/public-key.pem"
    ];
    const pass = runPython([...base, "--tenant", "acme-lab"]);
    expect(pass.status, JSON.stringify(pass.report.checks)).toBe(0);
    expect(pass.report.verdict).toBe("PASS");

    const wrongTenant = runPython([...base, "--tenant", "evil-corp"]);
    expect(wrongTenant.status).not.toBe(0);
    expect(wrongTenant.report.verdict).toBe("FAIL");
    expect(wrongTenant.report.checks.find((entry) => entry.name === "tenant")?.passed).toBe(false);
  });

  it("carries the verifier non-claim in every report", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: python3 is not available.");
      return;
    }
    const run = runPython([
      "--receipt",
      "examples/reproducibility/receipts/hmac-baseline.receipt.json",
      "--hmac-secret",
      "ghost-ark-repro-signing-dev-only-test-vector-v1"
    ]);
    expect(run.report.non_claim).toContain("does not prove model safety");
    expect(run.report.non_claim).toContain("not AWS evidence");
  });
});
