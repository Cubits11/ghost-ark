/**
 * Guards for E14 — verification over third-party primitives.
 *
 * The experiment's whole value rests on two properties that prose cannot hold:
 * that the arm really is independent of this repository's code, and that the
 * differential is capable of reporting a disagreement. A comparison that always
 * agrees because it cannot disagree is the E4 tautology, one level up.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { armAvailable, runE14 } from "../../../tools/experiments/e14ThirdPartyVerifier";
import { corpusTimeoutMs } from "../../support/corpusTimeout";

const REPO_ROOT = resolve(__dirname, "../../..");
const ARM = join(REPO_ROOT, "verifiers/thirdparty/ghost_receipt_verify_thirdparty.py");
const REPRO = join(REPO_ROOT, "examples/reproducibility");

const availability = armAvailable();
const REQUIRED = process.env.GHOST_ARK_REQUIRE_E14 === "1";

function runArm(args: string[]): { status: number | null; report: Record<string, unknown> } {
  const result = spawnSync("python3", [ARM, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  expect(result.stdout, `arm produced no stdout; stderr: ${result.stderr}`).not.toBe("");
  return { status: result.status, report: JSON.parse(result.stdout) as Record<string, unknown> };
}

const hmacArgs = (receipt: string): string[] => [
  "--receipt",
  receipt,
  "--hmac-secret",
  "ghost-ark-repro-signing-dev-only-test-vector-v1",
  "--expected-key-id",
  "local-dev-hmac"
];

describe("E14 arm independence (source-text properties)", () => {
  const source = readFileSync(ARM, "utf8");

  it("imports nothing from this repository", () => {
    // An arm that imports the thing it is checking is not an independent arm.
    // Matching on the import statements only: the file's prose deliberately
    // names Ghost-Ark paths when explaining what it does NOT use.
    const imports = [...source.matchAll(/^\s*(?:import|from)\s+([\w.]+)/gmu)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const module of imports) {
      expect(module.startsWith("."), `arm performs a relative import: ${module}`).toBe(false);
    }
    expect(source).not.toMatch(/packages\/|enforcement-runtime|receipt-schema\/src|tools\/repro/u);
  });

  it("computes no cryptography in-process — every primitive is delegated", () => {
    // hashlib and hmac are CPython's own and would still be "third-party" to
    // Ghost-Ark, but delegating to OpenSSL instead buys a second, separately
    // maintained implementation. The point of the arm is to maximise that
    // distance, so importing them would silently weaken it.
    expect(source).not.toMatch(/^\s*import\s+(hashlib|hmac)\b/mu);
    expect(source).toMatch(/openssl/u);
  });
});

describe("E14 differential over third-party primitives", () => {
  it("agrees with the Ghost-Ark verifier on every fixture", async () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      console.warn(`Skipping E14 differential: ${availability.detail}`);
      return;
    }
    const report = await runE14();
    expect(report.sample_provenance).toBe("census");
    expect(report.totals.fixtures).toBeGreaterThanOrEqual(30);
    expect(report.disagreements, JSON.stringify(report.disagreements)).toEqual([]);
    expect(report.totals.disagreements).toBe(0);
  }, corpusTimeoutMs(40));

  it("reproduces every committed canonical identity with a canonicalizer written elsewhere", async () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      return;
    }
    const report = await runE14();
    expect(report.totals.canonicalDigestComparisons).toBeGreaterThan(0);
    expect(report.totals.canonicalDigestAgreements).toBe(report.totals.canonicalDigestComparisons);
  }, corpusTimeoutMs(40));

  it("has an external oracle adjudicate exactly one PSS treatment per RSA fixture", async () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      return;
    }
    const report = await runE14();
    expect(report.pssAdjudication.length).toBeGreaterThan(0);
    for (const entry of report.pssAdjudication) {
      // E6 asserts non-interchangeability using this repository's own code.
      // Here OpenSSL says it, which is the first time an implementation from
      // outside the repository has adjudicated the question.
      expect(entry.acceptedModes, `${entry.fixtureId} must satisfy exactly one treatment`).toHaveLength(1);
    }
  }, corpusTimeoutMs(40));
});

describe("E14 discriminator — the arm can say no", () => {
  it("rejects a receipt whose signature has been tampered with", () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      return;
    }
    const receiptPath = join(REPRO, "receipts/hmac-baseline.receipt.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { receipt_signature: string };
    const clean = runArm(hmacArgs(receiptPath));
    expect(clean.report.verdict).toBe("PASS");

    const dir = mkdtempSync(join(tmpdir(), "ghost-ark-e14-"));
    const tampered = join(dir, "tampered.receipt.json");
    // Flip one base64url character of the envelope. The envelope still decodes
    // for most flips; whichever check catches it, the verdict must be FAIL.
    const flipped = receipt.receipt_signature.slice(0, -1) + (receipt.receipt_signature.endsWith("A") ? "B" : "A");
    writeFileSync(tampered, JSON.stringify({ ...receipt, receipt_signature: flipped }));
    const run = runArm(hmacArgs(tampered));
    expect(run.report.verdict).toBe("FAIL");
    expect(run.status).not.toBe(0);
  });

  it("rejects the RSA fixture under the PSS treatment it was not signed with", () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      return;
    }
    const base = [
      "--receipt",
      join(REPRO, "receipts/kms-style-rsa.receipt.json"),
      "--key",
      join(REPRO, "keys/kms-style-public-key.pem"),
      "--expected-key-id",
      "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-0000000000aa"
    ];
    const message = runArm([...base, "--pss-mode", "digest-as-message"]);
    const mhash = runArm([...base, "--pss-mode", "digest-as-mhash"]);
    expect(message.report.verdict).toBe("PASS");
    expect(mhash.report.verdict).toBe("FAIL");
  });

  it("rejects a valid receipt presented under the wrong expected key id", () => {
    if (!availability.available) {
      if (REQUIRED) throw new Error(`E14 required but unavailable: ${availability.detail}`);
      return;
    }
    const run = runArm([
      "--receipt",
      join(REPRO, "receipts/hmac-baseline.receipt.json"),
      "--hmac-secret",
      "ghost-ark-repro-signing-dev-only-test-vector-v1",
      "--expected-key-id",
      "not-the-signing-key"
    ]);
    expect(run.report.verdict).toBe("FAIL");
  });
});
