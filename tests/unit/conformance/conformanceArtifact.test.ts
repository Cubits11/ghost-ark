/**
 * Guards for the receipt-conformance suite (tools/receipt-conformance).
 *
 * The suite's whole value rests on properties prose cannot hold:
 *
 * 1. the committed artifact is exactly what a fresh generation from the
 *    pre-registered manifests produces — a hand-edited case would decouple the
 *    suite from the corpus that pre-registered its expectations;
 * 2. the harness is genuinely zero-Ghost-Ark-code, because its purpose is to
 *    check implementations written by people who must not need this repository;
 * 3. the reference verifiers actually conform — a suite no implementation
 *    passes specifies nothing;
 * 4. the harness CAN fail, on every level it scores. A conformance harness that
 *    cannot report nonconformance is the E4 tautology wearing a new name.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runSuite } from "../../../tools/receipt-conformance/run-conformance.mjs";
import { corpusTimeoutMs } from "../../support/corpusTimeout";

const REPO_ROOT = resolve(__dirname, "../../..");
const SUITE_DIR = join(REPO_ROOT, "tools/receipt-conformance");
const MANIFEST = join(SUITE_DIR, "conformance.json");
const NODE_VERIFIER = join(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs");
const PYTHON_VERIFIER = join(REPO_ROOT, "verifiers/python/ghost_receipt_verify.py");
const THIRD_PARTY_ARM = join(REPO_ROOT, "verifiers/thirdparty/ghost_receipt_verify_thirdparty.py");

const CASES = 36;
const pythonAvailable = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
const opensslAvailable = spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;

describe("conformance artifact integrity", () => {
  it("the committed artifact matches a fresh generation from the source manifests", () => {
    const result = spawnSync("node", [join(SUITE_DIR, "build-conformance.mjs"), "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("the shipped runner imports Node built-ins only and nothing from Ghost-Ark", () => {
    const source = readFileSync(join(SUITE_DIR, "run-conformance.mjs"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("node:"), `non-builtin import: ${specifier}`).toBe(true);
    }
  });

  it("declares 36 cases: 3 repro + 30 corpus + 3 PSS-treatment directions", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      cases: Array<{ case_id: string; expected_verdict: string; expected_failing_checks: string[] | null }>;
      non_claim: string;
    };
    expect(manifest.cases).toHaveLength(CASES);
    // Both PSS treatments must be asserted in BOTH directions; a suite that
    // only asserted the accepting direction could not catch a verifier that
    // accepts under either treatment.
    const ids = manifest.cases.map((entry) => entry.case_id);
    for (const required of [
      "valid-kms-style-rsa",
      "pss-kms-style-rsa-wrong-treatment",
      "valid-kms-digest-mode",
      "pss-kms-digest-mode-wrong-treatment"
    ]) {
      expect(ids).toContain(required);
    }
    // The two documented-boundary fixtures must be expected ACCEPTED: scoring
    // them as rejections would claim a detection no rule performs.
    for (const boundary of ["MAL-029", "MAL-030"]) {
      const entry = manifest.cases.find((candidate) => candidate.case_id === boundary);
      expect(entry?.expected_verdict).toBe("PASS");
    }
    expect(manifest.non_claim).toContain("does not close");
  });
});

describe("reference conformance", () => {
  it(
    "the standalone Node verifier is fully conformant on all three levels",
    () => {
      const report = runSuite(MANIFEST, ["node", NODE_VERIFIER]);
      expect(report.totals.cases).toBe(CASES);
      expect(report.totals.verdict_mismatches).toBe(0);
      expect(report.totals.failing_check_evaluated).toBe(30);
      expect(report.totals.failing_check_mismatches).toBe(0);
      expect(report.totals.identity_evaluated).toBe(4);
      expect(report.totals.identity_mismatches).toBe(0);
      expect(report.conformant).toBe(true);
    },
    corpusTimeoutMs(CASES)
  );

  it.runIf(pythonAvailable)(
    "the Python verifier is fully conformant on all three levels",
    () => {
      const report = runSuite(MANIFEST, ["python3", PYTHON_VERIFIER]);
      expect(report.conformant).toBe(true);
      expect(report.totals.verdict_mismatches).toBe(0);
      expect(report.totals.failing_check_mismatches).toBe(0);
      expect(report.totals.identity_mismatches).toBe(0);
    },
    corpusTimeoutMs(CASES)
  );

  it.runIf(pythonAvailable && opensslAvailable)(
    "the E14 third-party arm is verdict-conformant but check-NONconformant — a real, recorded mismatch",
    () => {
      // The arm's schema layer is deliberately thin (its job is delegating
      // cryptography, not reimplementing the field contract), so MAL-019,
      // MAL-023 and MAL-026 are rejected via an incidental receipt_id mismatch
      // rather than the declared schema check. Verdict-level agreement hides
      // that; the failing-check level is what exposes it. This test pins the
      // exposure: if it starts passing cleanly, either the arm gained a full
      // schema check (update this test and the docs) or the suite lost the
      // ability to see the difference (a defect).
      const report = runSuite(MANIFEST, ["python3", THIRD_PARTY_ARM]);
      expect(report.totals.verdict_mismatches).toBe(0);
      expect(report.totals.failing_check_mismatches).toBe(3);
      expect(
        report.results
          .filter((entry: { failing_check: string }) => entry.failing_check === "mismatch")
          .map((entry: { case_id: string }) => entry.case_id)
          .sort()
      ).toEqual(["MAL-019", "MAL-023", "MAL-026"]);
      expect(report.conformant).toBe(false);
    },
    corpusTimeoutMs(CASES * 4)
  );
});

describe("the harness can fail (discriminator principle)", () => {
  // Each mutant candidate is a real script file: `node -e <code> --receipt …`
  // does not work because node consumes the appended flags as its own CLI
  // options and exits 9 — which would make an "accept-everything" mutant look
  // like a rejector and pass the wrong assertion for the wrong reason.
  const mutantDir = mkdtempSync(join(tmpdir(), "conformance-mutants-"));
  const mutant = (name: string, code: string): string => {
    const path = join(mutantDir, name);
    writeFileSync(path, code);
    return path;
  };

  it(
    "an accept-everything candidate is reported nonconformant on every rejection case",
    () => {
      const report = runSuite(MANIFEST, ["node", mutant("accept-all.cjs", "process.exit(0);")]);
      expect(report.conformant).toBe(false);
      expect(report.totals.verdict_mismatches).toBe(30);
    },
    corpusTimeoutMs(CASES)
  );

  it(
    "a reject-everything candidate is reported nonconformant on every acceptance case",
    () => {
      const report = runSuite(MANIFEST, ["node", mutant("reject-all.cjs", "process.exit(1);")]);
      expect(report.conformant).toBe(false);
      expect(report.totals.verdict_mismatches).toBe(6);
    },
    corpusTimeoutMs(CASES)
  );

  it(
    "a candidate that rejects for the wrong reason fails the failing-check level",
    () => {
      // Rejects everything and blames a check name no case declares. Verdict
      // conformance catches the 6 wrong acceptances; the point here is that
      // every one of the 30 rejection cases must ALSO be scored a
      // failing-check mismatch, because the declared check never failed.
      const report = runSuite(MANIFEST, [
        "node",
        mutant(
          "wrong-reason.cjs",
          'console.log(JSON.stringify({checks:[{name:"wrong_reason",passed:false}]}));process.exit(1);'
        )
      ]);
      expect(report.totals.failing_check_evaluated).toBe(30);
      expect(report.totals.failing_check_mismatches).toBe(30);
      expect(report.conformant).toBe(false);
    },
    corpusTimeoutMs(CASES)
  );

  it(
    "a candidate that recomputes the wrong identity fails the identity level",
    () => {
      // Accepts everything AND asserts a wrong identity: both levels must object.
      const report = runSuite(MANIFEST, [
        "node",
        mutant(
          "wrong-identity.cjs",
          'console.log(JSON.stringify({recomputed:{receipt_id:"grct_"+"0".repeat(64),digest_sha256:"0".repeat(64)}}));process.exit(0);'
        )
      ]);
      expect(report.totals.identity_mismatches).toBe(4);
      expect(report.conformant).toBe(false);
    },
    corpusTimeoutMs(CASES)
  );

  it("refuses to run when a fixture is missing rather than shrinking the suite", () => {
    const scratch = mkdtempSync(join(tmpdir(), "conformance-refusal-"));
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { cases: Array<{ args: string[] }> };
    manifest.cases[0].args = ["--receipt", "fixtures/receipts/does-not-exist.receipt.json"];
    const mutatedPath = join(scratch, "conformance.json");
    writeFileSync(mutatedPath, JSON.stringify(manifest));
    expect(() => runSuite(mutatedPath, ["node", "-e", "process.exit(0)"])).toThrowError(/fixture missing/u);
  });
});
