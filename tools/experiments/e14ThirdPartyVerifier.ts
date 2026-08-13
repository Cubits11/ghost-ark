/**
 * E14 — Does the verification result survive an implementation whose
 * cryptography this project did not write?
 *
 * HYPOTHESIS. The accept/reject decisions this repository reports are properties
 * of the receipt rules, not of the author's reading of SHA-256, HMAC, base64url,
 * or RSASSA-PSS.
 *
 * WHY E5 CANNOT ANSWER THIS. E5 reports 0 disagreements across three verifiers —
 * TypeScript, standalone Node, and Python — and its own coverage boundary says
 * why that is weaker than it sounds: all three were written by one author from
 * one specification, and the Python arm hand-implements EMSA-PSS with the same
 * reading as the other two. Three implementations of one misreading agree
 * perfectly. That is precisely the failure mode this experiment attacks, and no
 * amount of internal agreement detects it.
 *
 * DESIGN. `verifiers/thirdparty/ghost_receipt_verify_thirdparty.py` runs the same
 * rule sequence with every security-relevant primitive delegated outside this
 * repository: canonical JSON and base64 by CPython's own libraries, and SHA-256,
 * HMAC-SHA-256 and RSASSA-PSS by the OpenSSL CLI. It imports no Ghost-Ark code —
 * `tests/unit/experiments/thirdPartyVerifier.test.ts` asserts that against the
 * source text. Every fixture in the reproducibility manifest and the malicious
 * corpus is then run through both arms and the decisions compared.
 *
 * PROVENANCE: census. Every fixture is run; exact counts, no intervals.
 *
 * WHAT THIS CLOSES AND WHAT IT DOES NOT. It closes shared-misreading risk for the
 * cryptographic and encoding layers: a mistake about PSS or base64url can no
 * longer hide, because a different set of authors decides those. It does NOT
 * close the gap the open-gaps list names. The rule sequencing — which checks run,
 * over which fields — is still this project's, and a misreading there would be
 * reproduced faithfully by both arms. Only an implementation by someone else,
 * from the specification, fixes that, and none exists.
 *
 * Command: npm run experiment:e14
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { privateHmacDigest } from "../../packages/enforcement-runtime/src/receipts/canonical";
import { verifyDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/verifier";
import type { DecisionReceiptCanonicalVerifier } from "../../packages/enforcement-runtime/src/receipts/verifier";
import { CorpusAttack, fixtureById, loadCorpusManifest, loadReproManifest } from "../repro/manifest";

const REPO_ROOT = resolve(__dirname, "../..");
const ARM = join(REPO_ROOT, "verifiers/thirdparty/ghost_receipt_verify_thirdparty.py");
const CORPUS_MANIFEST_PATH = "examples/malicious-receipts/manifest.json";
const IDENTITY_SECRET_DEV_ONLY = "ghost-ark-repro-identity-dev-only-test-vector-v1";

const NON_CLAIM =
  "E14 compares two implementations of the same receipt rules over a fixed fixture set, one of which " +
  "delegates all cryptography to third-party software. Agreement is differential evidence over these " +
  "fixtures only. It is not an audit, not a proof that the rules are complete or correct, not evidence " +
  "of an independently authored verifier, and not evidence about model safety, compliance, or AWS behaviour.";

export interface ThirdPartyCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ThirdPartyReport {
  readonly verdict: "PASS" | "FAIL";
  readonly checks: ThirdPartyCheck[];
  readonly recomputed?: { receipt_id: string; digest_sha256: string };
  readonly pss_accepted_modes?: string[];
  readonly primitives?: Record<string, string>;
}

export interface E14Cell {
  readonly fixtureId: string;
  readonly kind: "repro" | "corpus";
  readonly thirdPartyAccepted: boolean;
  readonly ghostArkAccepted: boolean;
  readonly agree: boolean;
  /** Present for RSA fixtures: which PSS treatments OpenSSL accepts. */
  readonly pssAcceptedModes?: string[];
  /** Did the third-party canonicalizer reproduce the committed digest? */
  readonly canonicalDigestAgrees?: boolean;
}

export interface E14Report {
  readonly schema_version: "ghost.e14_third_party_verifier.v1";
  readonly sample_provenance: "census";
  readonly primitives: Record<string, string>;
  readonly cells: E14Cell[];
  readonly totals: {
    readonly fixtures: number;
    readonly agreements: number;
    readonly disagreements: number;
    readonly canonicalDigestAgreements: number;
    readonly canonicalDigestComparisons: number;
  };
  readonly pssAdjudication: Array<{ fixtureId: string; acceptedModes: string[]; declaredAlgorithm: string }>;
  readonly disagreements: E14Cell[];
  readonly non_claim: string;
}

export function armAvailable(): { available: boolean; detail: string } {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.status !== 0) {
    return { available: false, detail: "python3 unavailable" };
  }
  const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
  if (openssl.status !== 0) {
    return { available: false, detail: "openssl unavailable" };
  }
  return { available: true, detail: `${python.stdout.trim()} / ${openssl.stdout.trim()}` };
}

function runArm(args: string[]): ThirdPartyReport {
  const result = spawnSync("python3", [ARM, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  if (!result.stdout) {
    throw new Error(`third-party arm produced no stdout: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as ThirdPartyReport;
}

export async function runE14(): Promise<E14Report> {
  const { manifest: corpus, baseDir: corpusBaseDir } = loadCorpusManifest(CORPUS_MANIFEST_PATH);
  const { manifest: repro, baseDir: reproBaseDir } = loadReproManifest(
    join(corpusBaseDir, corpus.repro_manifest_path)
  );
  const expectedDigests = JSON.parse(
    readFileSync(join(reproBaseDir, repro.expected_digests_path), "utf8")
  ) as { fixtures: Record<string, { receipt_id: string; digest_sha256: string }> };

  const cells: E14Cell[] = [];
  const pssAdjudication: E14Report["pssAdjudication"] = [];
  let primitives: Record<string, string> = {};

  for (const fixture of repro.fixtures) {
    const args = ["--receipt", join(reproBaseDir, fixture.paths.receipt), "--expected-key-id", fixture.signing.key_id];
    if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
      args.push("--key", join(reproBaseDir, fixture.signing.public_key_path ?? ""));
    } else {
      args.push("--hmac-secret", fixture.signing.hmac_secret_dev_only_test_vector ?? "");
    }
    const report = runArm(args);
    primitives = report.primitives ?? primitives;

    const verifier: DecisionReceiptCanonicalVerifier =
      fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256"
        ? new KmsDecisionReceiptVerifier({
            keyId: fixture.signing.key_id,
            publicKeyPem: readFileSync(join(reproBaseDir, fixture.signing.public_key_path ?? ""), "utf8")
          })
        : new LocalDevHmacReceiptSigner({
            secret: fixture.signing.hmac_secret_dev_only_test_vector ?? "",
            keyId: fixture.signing.key_id
          });
    const receipt = JSON.parse(readFileSync(join(reproBaseDir, fixture.paths.receipt), "utf8")) as unknown;
    const ghostArk = await verifyDecisionReceipt(receipt, verifier);

    const expected = expectedDigests.fixtures[fixture.fixture_id];
    const canonicalDigestAgrees =
      report.recomputed?.digest_sha256 === expected?.digest_sha256 &&
      report.recomputed?.receipt_id === expected?.receipt_id;

    cells.push({
      fixtureId: fixture.fixture_id,
      kind: "repro",
      thirdPartyAccepted: report.verdict === "PASS",
      ghostArkAccepted: ghostArk.verdict,
      agree: (report.verdict === "PASS") === ghostArk.verdict,
      pssAcceptedModes: report.pss_accepted_modes?.length ? report.pss_accepted_modes : undefined,
      canonicalDigestAgrees
    });

    if (fixture.signature_alg === "KMS_SIGN_RSASSA_PSS_SHA_256") {
      pssAdjudication.push({
        fixtureId: fixture.fixture_id,
        acceptedModes: report.pss_accepted_modes ?? [],
        declaredAlgorithm: fixture.signature_alg
      });
    }
  }

  for (const attack of corpus.attacks as CorpusAttack[]) {
    // Documented-boundary fixtures are ACCEPTED by design; they are asserted
    // positively elsewhere and are excluded here for the same reason E3 excludes
    // them from its rate rather than scoring them as wins.
    if (attack.expected_verdict === "accept_documented_boundary") {
      continue;
    }
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
    const report = runArm(args);

    let ghostArkAccepted: boolean;
    if (attack.fixture_kind === "malformed-json") {
      try {
        JSON.parse(readFileSync(join(corpusBaseDir, attack.receipt_path), "utf8"));
        ghostArkAccepted = true;
      } catch {
        ghostArkAccepted = false;
      }
    } else {
      const mutant = JSON.parse(readFileSync(join(corpusBaseDir, attack.receipt_path), "utf8")) as unknown;
      const verifier: DecisionReceiptCanonicalVerifier =
        attack.verifier === "kms_public_key"
          ? new KmsDecisionReceiptVerifier({
              keyId: base.signing.key_id,
              publicKeyPem: readFileSync(join(reproBaseDir, base.signing.public_key_path ?? ""), "utf8")
            })
          : new LocalDevHmacReceiptSigner({
              secret: base.signing.hmac_secret_dev_only_test_vector ?? "",
              keyId: base.signing.key_id
            });
      const result = await verifyDecisionReceipt(mutant, verifier);
      if (attack.expected_verdict === "reject_by_consumer_tenant_expectation") {
        const expectedTenantHash = privateHmacDigest(
          base.identity.hmac_secret_dev_only_test_vector,
          attack.expected_tenant_id ?? ""
        );
        ghostArkAccepted =
          result.verdict && (mutant as { tenant_id_hash?: string }).tenant_id_hash === expectedTenantHash;
      } else {
        ghostArkAccepted = result.verdict;
      }
    }

    cells.push({
      fixtureId: attack.attack_id,
      kind: "corpus",
      thirdPartyAccepted: report.verdict === "PASS",
      ghostArkAccepted,
      agree: (report.verdict === "PASS") === ghostArkAccepted,
      pssAcceptedModes: report.pss_accepted_modes?.length ? report.pss_accepted_modes : undefined
    });
  }

  const disagreements = cells.filter((cell) => !cell.agree);
  const digestComparisons = cells.filter((cell) => cell.canonicalDigestAgrees !== undefined);

  return {
    schema_version: "ghost.e14_third_party_verifier.v1",
    sample_provenance: "census",
    primitives,
    cells,
    totals: {
      fixtures: cells.length,
      agreements: cells.length - disagreements.length,
      disagreements: disagreements.length,
      canonicalDigestAgreements: digestComparisons.filter((cell) => cell.canonicalDigestAgrees).length,
      canonicalDigestComparisons: digestComparisons.length
    },
    pssAdjudication,
    disagreements,
    non_claim: NON_CLAIM
  };
}

async function main(): Promise<void> {
  const availability = armAvailable();
  if (!availability.available) {
    // Same guard as E1 and E11: an arm that cannot run excludes the census
    // rather than degrading it silently.
    console.error(
      `ghost_ark.e14: the third-party arm could not be executed (${availability.detail}). ` +
        "Refusing to emit a report, because a missing arm changes the agreement count rather than merely widening it."
    );
    process.exitCode = process.env.GHOST_ARK_REQUIRE_E14 === "1" ? 1 : 0;
    return;
  }

  const report = await runE14();
  const json = process.argv.includes("--json");
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log("E14 — verification over third-party primitives");
    console.log(`  primitives: ${Object.values(report.primitives).join(" | ")}`);
    console.log(
      `  fixtures compared:            ${report.totals.fixtures} (${report.totals.agreements} agree, ${report.totals.disagreements} disagree)`
    );
    console.log(
      `  canonical identity reproduced by CPython: ${report.totals.canonicalDigestAgreements}/${report.totals.canonicalDigestComparisons}`
    );
    for (const entry of report.pssAdjudication) {
      console.log(
        `  PSS adjudication (OpenSSL) ${entry.fixtureId}: accepts [${entry.acceptedModes.join(", ") || "none"}] for ${entry.declaredAlgorithm}`
      );
    }
    if (report.disagreements.length > 0) {
      console.log("  DISAGREEMENTS:");
      for (const cell of report.disagreements) {
        console.log(
          `    ${cell.fixtureId}: third-party ${cell.thirdPartyAccepted ? "ACCEPT" : "REJECT"} vs ghost-ark ${cell.ghostArkAccepted ? "ACCEPT" : "REJECT"}`
        );
      }
    }
    console.log(`  non-claim: ${report.non_claim}`);
  }

  const outDir = join(REPO_ROOT, "artifacts");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "e14-third-party-verifier.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  void main();
}

// Referenced so a future refactor that drops the CLI still fails loudly here.
export const THIRD_PARTY_ARM_PATH = ARM;
export { execFileSync };
