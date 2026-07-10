import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const replayPath = join(repoRoot, "verifiers/node/replay_receipt_manifests.mjs");
const verifierPath = join(repoRoot, "verifiers/node/ghost_receipt_verify.mjs");
const reproManifestPath = join(repoRoot, "examples/reproducibility/manifest.json");
const corpusManifestPath = join(repoRoot, "examples/malicious-receipts/manifest.json");
const reproBaseDir = dirname(reproManifestPath);
const corpusBaseDir = dirname(corpusManifestPath);

interface Fixture {
  fixture_id: string;
  signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY" | "KMS_SIGN_RSASSA_PSS_SHA_256";
  signing: {
    key_id: string;
    hmac_secret_dev_only_test_vector?: string;
    public_key_path?: string;
  };
  identity: {
    tenant_id: string;
    hmac_secret_dev_only_test_vector: string;
  };
  paths: { receipt: string };
}

interface ReproManifest {
  expected_digests_path: string;
  fixtures: Fixture[];
}

interface Attack {
  attack_id: string;
  base_fixture_id: string;
  receipt_path: string;
  expected_verdict: "reject" | "reject_by_consumer_tenant_expectation";
  expected_rejection_phase: string;
  expected_error_substring: string | null;
  expected_tenant_id?: string;
  [key: string]: unknown;
}

interface CorpusManifest {
  schema_version: string;
  repro_manifest_path: string;
  attacks: Attack[];
  [key: string]: unknown;
}

interface FailedCheck {
  name: string;
  detail: string;
}

interface ReplayReport {
  schema_version: string;
  verdict: "PASS" | "FAIL";
  summary: {
    repro: {
      total: number;
      matched: number;
      unexpected_rejections: number;
      commitment_mismatches: number;
    };
    corpus: {
      total: number;
      matched: number;
      unexpected_acceptances: number;
      expectation_mismatches: number;
    };
  };
  repro_cases: Array<{
    fixture_id: string;
    expected_receipt_id: string;
    observed_receipt_id: string | null;
    expected_digest_sha256: string;
    observed_digest_sha256: string | null;
    matched: boolean;
  }>;
  corpus_cases: Array<{
    attack_id: string;
    observed_verdict: "PASS" | "FAIL";
    observed_failed_checks: FailedCheck[];
    matched: boolean;
    mismatches: string[];
  }>;
  errors: Array<{ code: string; detail: string }>;
}

interface VerifierReport {
  verdict: "PASS" | "FAIL";
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runJsonCli<T>(script: string, args: string[] = []): { status: number | null; stdout: string; stderr: string; report: T } {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout, result.stderr).not.toBe("");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report: JSON.parse(result.stdout) as T
  };
}

function runReplay(args: string[] = []) {
  return runJsonCli<ReplayReport>(replayPath, args);
}

const repro = readJson<ReproManifest>(reproManifestPath);
const corpus = readJson<CorpusManifest>(corpusManifestPath);

function fixtureById(fixtureId: string): Fixture {
  const fixture = repro.fixtures.find((entry) => entry.fixture_id === fixtureId);
  if (!fixture) {
    throw new Error(`Unknown fixture ${fixtureId}.`);
  }
  return fixture;
}

function directVerifierArgs(attack: Attack): string[] {
  const fixture = fixtureById(attack.base_fixture_id);
  const args = [
    "--receipt",
    join(corpusBaseDir, attack.receipt_path),
    "--expected-key-id",
    fixture.signing.key_id
  ];
  if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
    args.push("--key", join(reproBaseDir, fixture.signing.public_key_path ?? ""));
  } else {
    args.push("--hmac-secret", fixture.signing.hmac_secret_dev_only_test_vector ?? "");
  }
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

function withTemporaryCorpus(attacks: Attack[], callback: (path: string) => void): void {
  const directory = mkdtempSync(join(repoRoot, ".ghost-manifest-replay-"));
  const path = join(directory, "manifest.json");
  try {
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...corpus,
          repro_manifest_path: reproManifestPath,
          attacks
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    callback(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("standalone receipt manifest replay CLI", () => {
  it("uses only local builtins and the builtins-only verifier adapter", () => {
    const source = readFileSync(replayPath, "utf8");
    const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map((match) => match[1]);

    expect(importSpecifiers).toEqual([
      "node:fs",
      "node:path",
      "node:url",
      "./ghost_receipt_verify.mjs"
    ]);
    expect(source).not.toMatch(/@aws-sdk|aws-sdk|\bfetch\s*\(|https?\.request|process\.env|child_process/u);
    expect(source).not.toMatch(/packages\/|tools\/ghost-verify/u);
  });

  it("emits a deterministic machine-readable PASS summary for the committed manifests", () => {
    const first = runReplay();
    const second = runReplay();
    const expectedDigests = readJson<{
      fixtures: Record<string, { receipt_id: string; digest_sha256: string }>;
    }>(join(reproBaseDir, repro.expected_digests_path));

    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toBe(second.stdout);
    expect(first.report.schema_version).toBe("ghost.node_manifest_replay_report.v1");
    expect(first.report.verdict).toBe("PASS");
    expect(first.report.errors).toEqual([]);
    expect(first.report.summary).toEqual({
      repro: {
        total: repro.fixtures.length,
        matched: repro.fixtures.length,
        unexpected_rejections: 0,
        commitment_mismatches: 0
      },
      corpus: {
        total: corpus.attacks.length,
        matched: corpus.attacks.length,
        unexpected_acceptances: 0,
        expectation_mismatches: 0
      }
    });
    expect(first.report.repro_cases.map((entry) => entry.fixture_id)).toEqual(
      repro.fixtures.map((entry) => entry.fixture_id)
    );
    for (const entry of first.report.repro_cases) {
      const expected = expectedDigests.fixtures[entry.fixture_id];
      expect(entry.matched).toBe(true);
      expect(entry.observed_receipt_id).toBe(expected.receipt_id);
      expect(entry.observed_digest_sha256).toBe(expected.digest_sha256);
    }
    expect(first.report.corpus_cases.map((entry) => entry.attack_id)).toEqual(
      corpus.attacks.map((entry) => entry.attack_id)
    );
    expect(first.report.corpus_cases.every((entry) => entry.matched)).toBe(true);
  });

  it("matches the per-receipt CLI across HMAC, RSA, tenant, and malformed-JSON boundaries", () => {
    const replay = runReplay().report;
    const representativeIds = ["MAL-001", "MAL-005", "MAL-014", "MAL-024"];

    for (const attackId of representativeIds) {
      const attack = corpus.attacks.find((entry) => entry.attack_id === attackId);
      const replayCase = replay.corpus_cases.find((entry) => entry.attack_id === attackId);
      expect(attack).toBeDefined();
      expect(replayCase).toBeDefined();
      if (!attack || !replayCase) {
        continue;
      }

      const direct = runJsonCli<VerifierReport>(verifierPath, directVerifierArgs(attack));
      const directFailedChecks = direct.report.checks.filter((entry) => !entry.passed).map((entry) => entry.name);
      expect(replayCase.observed_verdict).toBe(direct.report.verdict);
      expect(replayCase.observed_failed_checks.map((entry) => entry.name)).toEqual(directFailedChecks);
      expect(replayCase.observed_failed_checks.map((entry) => entry.name)).toContain(attack.expected_rejection_phase);
    }
  });

  it("exits nonzero when a manifest-declared mutant is unexpectedly accepted", () => {
    const sourceAttack = corpus.attacks[0];
    const validReceiptPath = join(reproBaseDir, fixtureById(sourceAttack.base_fixture_id).paths.receipt);
    const acceptedAttack: Attack = {
      ...sourceAttack,
      attack_id: "TEST-UNEXPECTED-ACCEPTANCE",
      receipt_path: validReceiptPath
    };

    withTemporaryCorpus([acceptedAttack], (path) => {
      const run = runReplay(["--repro-manifest", reproManifestPath, "--corpus-manifest", path]);

      expect(run.status).not.toBe(0);
      expect(run.report.verdict).toBe("FAIL");
      expect(run.report.summary.corpus).toEqual({
        total: 1,
        matched: 0,
        unexpected_acceptances: 1,
        expectation_mismatches: 0
      });
      expect(run.report.corpus_cases[0]).toMatchObject({
        attack_id: "TEST-UNEXPECTED-ACCEPTANCE",
        observed_verdict: "PASS",
        matched: false
      });
      expect(run.report.corpus_cases[0].mismatches).toContain("unexpected_acceptance");
    });
  });

  it("exits nonzero when rejection occurs at a different boundary than the manifest declares", () => {
    const mismatchedAttack: Attack = {
      ...corpus.attacks[0],
      expected_rejection_phase: "schema",
      expected_error_substring: null
    };

    withTemporaryCorpus([mismatchedAttack], (path) => {
      const first = runReplay(["--repro-manifest", reproManifestPath, "--corpus-manifest", path]);
      const second = runReplay(["--repro-manifest", reproManifestPath, "--corpus-manifest", path]);

      expect(first.status).not.toBe(0);
      expect(first.stdout).toBe(second.stdout);
      expect(first.report.verdict).toBe("FAIL");
      expect(first.report.summary.corpus).toEqual({
        total: 1,
        matched: 0,
        unexpected_acceptances: 0,
        expectation_mismatches: 1
      });
      expect(first.report.corpus_cases[0]).toMatchObject({
        attack_id: corpus.attacks[0].attack_id,
        observed_verdict: "FAIL",
        matched: false,
        mismatches: ["rejection_phase_mismatch"]
      });
    });
  });
});
