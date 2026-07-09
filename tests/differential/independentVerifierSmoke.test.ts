import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const pythonVerifier = join(repoRoot, "verifiers/python/ghost_receipt_verify.py");
const receiptPath = join(repoRoot, "examples/reproducibility/receipts/hmac-baseline.receipt.json");
const expectedDigestsPath = join(repoRoot, "examples/reproducibility/expected-digests.json");
const devOnlyHmacSecret = "ghost-ark-repro-signing-dev-only-test-vector-v1";

function hasPython3(): boolean {
  const result = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

describe("independent Python receipt verifier smoke", () => {
  it("matches the TypeScript expected digest fixture for hmac-baseline", () => {
    if (!existsSync(pythonVerifier)) {
      throw new Error(`Missing Python verifier: ${pythonVerifier}`);
    }

    if (!hasPython3()) {
      console.warn("Skipping Python verifier smoke test because python3 is not available.");
      return;
    }

    const expected = JSON.parse(readFileSync(expectedDigestsPath, "utf8")) as {
      fixtures: Record<string, { receipt_id: string; digest_sha256: string; signed_receipt_hash: string }>;
    };

    const result = spawnSync(
      "python3",
      [
        pythonVerifier,
        "--receipt",
        receiptPath,
        "--hmac-secret",
        devOnlyHmacSecret
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const report = JSON.parse(result.stdout) as {
      verdict: string;
      recomputed: {
        receipt_id: string;
        digest_sha256: string;
      };
      non_claim: string;
    };

    expect(report.verdict).toBe("PASS");
    expect(report.recomputed.receipt_id).toBe(expected.fixtures["hmac-baseline"].receipt_id);
    expect(report.recomputed.digest_sha256).toBe(expected.fixtures["hmac-baseline"].digest_sha256);
    expect(report.non_claim).toContain("does not prove model safety");
  });

  it("rejects a mutated malicious receipt fixture", () => {
    if (!existsSync(pythonVerifier)) {
      throw new Error(`Missing Python verifier: ${pythonVerifier}`);
    }

    if (!hasPython3()) {
      console.warn("Skipping Python verifier negative smoke test because python3 is not available.");
      return;
    }

    const mutatedReceiptPath = join(
      repoRoot,
      "examples/malicious-receipts/receipts/MAL-002.altered-envelope-digest.receipt.json"
    );

    const result = spawnSync(
      "python3",
      [
        pythonVerifier,
        "--receipt",
        mutatedReceiptPath,
        "--hmac-secret",
        devOnlyHmacSecret
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.stdout, result.stderr).not.toBe("");

    const report = JSON.parse(result.stdout) as {
      verdict: string;
      checks: Array<{ name: string; passed: boolean; detail: string }>;
      non_claim: string;
    };

    expect(result.status).not.toBe(0);
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.some((check) => !check.passed)).toBe(true);
    expect(report.non_claim).toContain("does not prove model safety");
  });
});
