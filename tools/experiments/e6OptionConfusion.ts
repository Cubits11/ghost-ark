/**
 * E6 — Verifier option-confusion matrix.
 *
 * The question
 * ------------
 * A verifier's verdict depends on the options the CONSUMER supplies, not only on the receipt.
 * `verifyReceipt` accepts seven: expectedKeyId, expectedTenantIdHash, hmacSecret,
 * identityHmacSecret, pssMode, publicKeyPem, tenant. So:
 *
 *   Is there any option combination under which an invalid receipt is ACCEPTED, or a receipt
 *   is accepted on WRONG or ABSENT key material?
 *
 * Scope discipline
 * ----------------
 * This experiment is built against the option surface that exists. There is no `skip_expiry`,
 * no `allow_untrusted_issuer`, and no `UNSAFE_` override in this verifier, so there is no 2^k
 * space of safety-bypass flags to enumerate. Inventing them would produce a matrix that tested
 * nothing, which is the failure mode this repository exists to catch. The real surface is
 * smaller and the interesting axes are key material, identity expectations, and PSS mode.
 *
 * The headline property
 * --------------------
 * I5, ANTITONICITY, is the operational form of the thesis. `Sound(C, Sigma, P)` is antitone in
 * the consumer set: adding a consumer can only add distinctions that must be preserved, never
 * remove one. Operationally that means:
 *
 *   Adding a CORRECT expectation must never turn a FAIL into a PASS.
 *
 * The accepted set must shrink monotonically as expectations are added. If it ever grows, the
 * verifier is not antitone in its consumer set and the thesis's central structural claim fails
 * to hold for this implementation. E6 measures that directly rather than assuming it.
 *
 * NON-CLAIM: E6 enumerates a declared option cross-product over declared fixtures under this
 * verifier's documented rules. It is not an exhaustive search of consumer misconfiguration, not
 * evidence of cryptographic strength, and not evidence of model safety, semantic truth,
 * compliance, or AWS behavior. A cell that passes is not thereby correct.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { loadEsmModule } from "./loadEsm";

export const E6_REPORT_SCHEMA_VERSION = "ghost.e6_option_confusion.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const REPRO_DIR = resolve(REPO_ROOT, "examples/reproducibility");

const HMAC_SIGNING_VECTOR = "ghost-ark-repro-signing-dev-only-test-vector-v1";
const HMAC_IDENTITY_VECTOR = "ghost-ark-repro-identity-dev-only-test-vector-v1";
const HMAC_KEY_ID = "local-dev-hmac";
const WRONG_SECRET = "ghost-ark-wrong-dev-only-test-vector-not-a-credential";
const CORRECT_TENANT = "tenant-repro-a";
const WRONG_TENANT = "tenant-repro-b";

type VerifierModule = {
  verifyReceipt: (receipt: unknown, options?: Record<string, unknown>) => { verdict: string };
};

/** Axis values. "absent" is as important as "wrong": both must fail closed. */
export type KeyMaterial = "absent" | "correct" | "wrong";
export type Expectation = "absent" | "correct" | "wrong";
/**
 * Tenant expectation is defined RELATIVE TO THE RECEIPT, not to a fixed tenant.
 *
 * An earlier version of this experiment used a global correct/wrong pair and reported two
 * invariant violations. Both were artifacts of that labelling. MAL-028's tenant_id_hash IS
 * tenant-repro-b's commitment, so supplying tenant-repro-b is the MATCHING expectation for it,
 * and MAL-014 is a valid tenant-repro-a receipt that a tenant-repro-a consumer should accept.
 * Their maliciousness is RELATIONAL -- they are correct receipts presented to the wrong consumer
 * -- so a globally-fixed "correct tenant" is not a well-defined axis.
 */
export type TenantExpectation = "absent" | "matches-receipt" | "mismatches-receipt";
export type PssMode = "digest-as-message" | "digest-as-mhash";

export interface OptionCell {
  fixtureId: string;
  /** Whether the fixture itself is a valid receipt or a known-bad one. */
  fixtureValidity: "valid" | "malicious";
  keyMaterial: KeyMaterial;
  expectedKeyId: Expectation;
  tenantExpectation: TenantExpectation;
  pssMode: PssMode;
  /** Number of CORRECT expectations supplied. Drives the antitonicity check. */
  correctExpectationCount: number;
  verdict: "PASS" | "FAIL";
}

export interface InvariantResult {
  id: string;
  statement: string;
  /** Cells that violate it. Empty means the invariant held over this matrix. */
  violations: OptionCell[];
  held: boolean;
}

export interface E6Report {
  schema_version: typeof E6_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  cellCount: number;
  passCount: number;
  cells: OptionCell[];
  invariants: InvariantResult[];
  /** Proportion of enumerated cells that accepted. Reported for shape, not as a score. */
  acceptanceRate: ProportionReport;
  non_claim: string;
}

const NON_CLAIM =
  "E6 enumerates a declared option cross-product over declared fixtures under this verifier's documented rules. It is " +
  "not an exhaustive search of consumer misconfiguration, not evidence of cryptographic strength, and not evidence of " +
  "model safety, semantic truth, compliance, or AWS behavior. A cell that accepts is not thereby correct.";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function tenantCommitment(tenant: string): string {
  return `hmac-sha256:${createHmac("sha256", HMAC_IDENTITY_VECTOR).update(tenant).digest("hex")}`;
}

interface FixtureUnderTest {
  id: string;
  path: string;
  validity: "valid" | "malicious";
  algorithm: "hmac" | "rsa";
  /**
   * "intrinsic" defects are wrong on their own terms and must never be accepted under any
   * option combination. "relational" fixtures are VALID receipts that are wrong only for a
   * particular consumer, so they must be accepted by a matching consumer and rejected by a
   * mismatching one. Conflating the two would assert that a correct receipt must be rejected.
   */
  defectKind: "intrinsic" | "relational" | "documented-boundary" | "none";
}

function collectFixtures(): FixtureUnderTest[] {
  const repro = readJson<{ fixtures: { fixture_id: string; signature_alg: string }[] }>(resolve(REPRO_DIR, "manifest.json"));

  const fixtures: FixtureUnderTest[] = repro.fixtures.map((fixture) => ({
    id: fixture.fixture_id,
    path: resolve(REPRO_DIR, "receipts", `${fixture.fixture_id}.receipt.json`),
    validity: "valid",
    algorithm: fixture.signature_alg === "LOCAL_HMAC_SHA256_DEV_ONLY" ? "hmac" : "rsa",
    defectKind: "none"
  }));

  // A malicious sample spanning the distinct rejection mechanisms, plus the two
  // compromised-signer fixtures whose signatures are genuinely valid. The latter matter most
  // here: a validly-signed malicious receipt is exactly where an option mistake could matter.
  const maliciousSample: { name: string; defectKind: FixtureUnderTest["defectKind"] }[] = [
    { name: "MAL-003.altered-signature", defectKind: "intrinsic" },
    { name: "MAL-013.tenant-id-hash-mutation", defectKind: "intrinsic" },
    { name: "MAL-027.signed-receipt-id-inconsistency", defectKind: "intrinsic" },
    // Valid receipts that are wrong only for a mismatching consumer.
    { name: "MAL-014.cross-tenant-verifier-mismatch", defectKind: "relational" },
    { name: "MAL-028.signed-cross-tenant-substitution", defectKind: "relational" },
    // Accepted by design; see EXPERIMENTS.md E4-B.
    { name: "MAL-029.signed-timestamp-backdating", defectKind: "documented-boundary" },
    { name: "MAL-030.signed-decision-escalation", defectKind: "documented-boundary" }
  ];

  for (const entry of maliciousSample) {
    fixtures.push({
      id: entry.name.split(".")[0] as string,
      path: resolve(CORPUS_DIR, "receipts", `${entry.name}.receipt.json`),
      validity: "malicious",
      algorithm: "hmac",
      defectKind: entry.defectKind
    });
  }

  return fixtures;
}

/**
 * Which declared tenant's commitment equals this receipt's tenant_id_hash. Returns null when
 * neither does, in which case both expectations mismatch.
 */
function matchingTenantFor(receipt: unknown): string | null {
  const declared = (receipt as { tenant_id_hash?: string } | null)?.tenant_id_hash;
  for (const tenant of [CORRECT_TENANT, WRONG_TENANT]) {
    if (declared === tenantCommitment(tenant)) {
      return tenant;
    }
  }
  return null;
}

function buildOptions(
  fixture: FixtureUnderTest,
  keyMaterial: KeyMaterial,
  expectedKeyId: Expectation,
  tenantExpectation: TenantExpectation,
  pssMode: PssMode,
  matchingTenant: string | null
): Record<string, unknown> {
  const options: Record<string, unknown> = { pssMode };

  if (keyMaterial !== "absent") {
    if (fixture.algorithm === "hmac") {
      options.hmacSecret = keyMaterial === "correct" ? HMAC_SIGNING_VECTOR : WRONG_SECRET;
    } else {
      const keyPath = keyMaterial === "correct" ? "keys/kms-style-public-key.pem" : "pss-digest-mode/public-key.pem";
      try {
        options.publicKeyPem = readFileSync(resolve(REPRO_DIR, keyPath), "utf8");
      } catch {
        // Absent key file behaves as absent key material; recorded by the resulting verdict.
      }
    }
  }

  if (expectedKeyId !== "absent") {
    options.expectedKeyId = expectedKeyId === "correct" ? HMAC_KEY_ID : "some-other-key-id";
  }

  if (tenantExpectation !== "absent") {
    const other = matchingTenant === CORRECT_TENANT ? WRONG_TENANT : CORRECT_TENANT;
    const tenant = tenantExpectation === "matches-receipt" ? (matchingTenant ?? CORRECT_TENANT) : other;
    options.tenant = tenant;
    options.identityHmacSecret = HMAC_IDENTITY_VECTOR;
    options.expectedTenantIdHash = tenantCommitment(tenant);
  }

  return options;
}

const KEY_MATERIALS: KeyMaterial[] = ["absent", "correct", "wrong"];
const EXPECTATIONS: Expectation[] = ["absent", "correct", "wrong"];
const TENANT_EXPECTATIONS: TenantExpectation[] = ["absent", "matches-receipt", "mismatches-receipt"];
const PSS_MODES: PssMode[] = ["digest-as-message", "digest-as-mhash"];

export function runE6OptionConfusion(): E6Report {
  const verifier = loadEsmModule<VerifierModule>(resolve(REPO_ROOT, "verifiers/node/ghost_receipt_verify.mjs"));
  const fixtures = collectFixtures();
  const cells: OptionCell[] = [];

  for (const fixture of fixtures) {
    let receipt: unknown;
    try {
      receipt = readJson<unknown>(fixture.path);
    } catch {
      continue;
    }

    for (const keyMaterial of KEY_MATERIALS) {
      for (const expectedKeyId of EXPECTATIONS) {
        for (const tenantExpectation of TENANT_EXPECTATIONS) {
          for (const pssMode of PSS_MODES) {
            const options = buildOptions(fixture, keyMaterial, expectedKeyId, tenantExpectation, pssMode, matchingTenantFor(receipt));

            let verdict: "PASS" | "FAIL";
            try {
              verdict = verifier.verifyReceipt(receipt, options).verdict === "PASS" ? "PASS" : "FAIL";
            } catch {
              verdict = "FAIL";
            }

            cells.push({
              fixtureId: fixture.id,
              fixtureValidity: fixture.validity,
              keyMaterial,
              expectedKeyId,
              tenantExpectation,
              pssMode,
              correctExpectationCount:
                (expectedKeyId === "correct" ? 1 : 0) + (tenantExpectation === "matches-receipt" ? 1 : 0),
              verdict
            });
          }
        }
      }
    }
  }

  const passing = cells.filter((cell) => cell.verdict === "PASS");

  const invariants: InvariantResult[] = [];

  function record(id: string, statement: string, violations: OptionCell[]): void {
    invariants.push({ id, statement, violations, held: violations.length === 0 });
  }

  record(
    "I1",
    "Fail closed on ABSENT key material: nothing is accepted without a secret or public key.",
    passing.filter((cell) => cell.keyMaterial === "absent")
  );

  record(
    "I2",
    "Fail closed on WRONG key material: nothing is accepted under an incorrect secret or key.",
    passing.filter((cell) => cell.keyMaterial === "wrong")
  );

  record(
    "I3",
    "A WRONG expectedKeyId is never accepted.",
    passing.filter((cell) => cell.expectedKeyId === "wrong")
  );

  record(
    "I4",
    "A MISMATCHING tenant expectation is never accepted: a consumer expecting tenant X rejects a tenant-Y receipt.",
    passing.filter((cell) => cell.tenantExpectation === "mismatches-receipt")
  );

  // I5 is the thesis, measured. For each fixture and each fixed non-expectation context, the
  // accepted set must not GROW as correct expectations are added.
  const antitoneViolations: OptionCell[] = [];
  for (const fixture of new Set(cells.map((cell) => cell.fixtureId))) {
    for (const keyMaterial of KEY_MATERIALS) {
      for (const pssMode of PSS_MODES) {
        const context = cells.filter(
          (cell) =>
            cell.fixtureId === fixture &&
            cell.keyMaterial === keyMaterial &&
            cell.pssMode === pssMode &&
            cell.expectedKeyId !== "wrong" &&
            cell.tenantExpectation !== "mismatches-receipt"
        );
        const byCount = new Map<number, OptionCell[]>();
        for (const cell of context) {
          byCount.set(cell.correctExpectationCount, [...(byCount.get(cell.correctExpectationCount) ?? []), cell]);
        }
        const counts = [...byCount.keys()].sort((left, right) => left - right);
        for (let index = 1; index < counts.length; index += 1) {
          const fewer = byCount.get(counts[index - 1] as number) ?? [];
          const more = byCount.get(counts[index] as number) ?? [];
          const fewerAccepted = fewer.some((cell) => cell.verdict === "PASS");
          // Adding a correct expectation must never turn a FAIL into a PASS.
          if (!fewerAccepted) {
            antitoneViolations.push(...more.filter((cell) => cell.verdict === "PASS"));
          }
        }
      }
    }
  }
  record(
    "I5",
    "ANTITONE in the consumer set: adding a CORRECT expectation never turns a rejection into an acceptance.",
    antitoneViolations
  );

  // Only INTRINSIC defects are held to "never accepted under any options". A relational fixture
  // is a valid receipt whose defect exists only for a mismatching consumer, so requiring it to
  // be rejected unconditionally would assert that a correct receipt must be rejected. Documented
  // boundaries are accepted by design.
  const intrinsicIds = new Set(fixtures.filter((fixture) => fixture.defectKind === "intrinsic").map((fixture) => fixture.id));
  record(
    "I6",
    "An INTRINSICALLY invalid receipt is never accepted under ANY option combination.",
    passing.filter((cell) => intrinsicIds.has(cell.fixtureId))
  );

  record(
    "I7",
    "A RELATIONAL fixture is accepted by a matching consumer and rejected by a mismatching one, which is the antitone property at fixture level.",
    (() => {
      const relationalIds = new Set(fixtures.filter((fixture) => fixture.defectKind === "relational").map((fixture) => fixture.id));
      // A violation is a relational fixture accepted while the consumer MISMATCHES it.
      return passing.filter((cell) => relationalIds.has(cell.fixtureId) && cell.tenantExpectation === "mismatches-receipt");
    })()
  );

  // PSS-mode substitution. RSASSA-PSS over a digest can treat the digest as the MESSAGE or as
  // the mHash, and the two are not interchangeable. A receipt signed under one mode must not
  // verify under the other; if it did, a consumer could be induced to accept a signature the
  // signer never produced for that interpretation.
  const rsaFixtureIds = new Set(fixtures.filter((fixture) => fixture.algorithm === "rsa").map((fixture) => fixture.id));
  const rsaAccepted = passing.filter((cell) => rsaFixtureIds.has(cell.fixtureId));
  const acceptedModes = new Set(rsaAccepted.map((cell) => cell.pssMode));
  record(
    "I8",
    "PSS-mode substitution is never accepted: an RSA receipt verifies under exactly one of digest-as-message / digest-as-mhash, never both.",
    acceptedModes.size > 1 ? rsaAccepted : []
  );

  const neverCalled = (): { low: number; high: number } => {
    throw new Error("ghost_ark.e6: an interval provider must never be invoked for a census.");
  };

  return {
    schema_version: E6_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    cellCount: cells.length,
    passCount: passing.length,
    cells,
    invariants,
    acceptanceRate: reportProportion(passing.length, Math.max(1, cells.length), "census", neverCalled),
    non_claim: NON_CLAIM
  };
}

function main(): void {
  const report = runE6OptionConfusion();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E6 verifier option-confusion matrix (${report.schema_version})`);
  lines.push(`enumerated ${report.cellCount} (fixture x key-material x expectedKeyId x tenant x pssMode) cells; ${report.passCount} accepted`);
  lines.push("axes are the REAL option surface: there is no skip_expiry, allow_untrusted_issuer, or UNSAFE_ override in this verifier");
  lines.push("");
  lines.push("invariants:");
  for (const invariant of report.invariants) {
    lines.push(`  ${invariant.held ? "HELD    " : "VIOLATED"} ${invariant.id}  ${invariant.statement}`);
    for (const violation of invariant.violations.slice(0, 8)) {
      lines.push(
        `             ! ${violation.fixtureId} key=${violation.keyMaterial} keyId=${violation.expectedKeyId} tenant=${violation.tenantExpectation} pss=${violation.pssMode}`
      );
    }
    if (invariant.violations.length > 8) {
      lines.push(`             ... and ${invariant.violations.length - 8} more`);
    }
  }
  lines.push("");

  // The accepted cells, which is the surface a consumer can actually reach.
  const rsaModes = [...new Set(report.cells.filter((cell) => cell.verdict === "PASS" && cell.fixtureId.startsWith("kms")).map((cell) => cell.pssMode))];
  lines.push(`RSA acceptance is confined to pssMode: ${rsaModes.join(", ") || "(none accepted)"} — substitution into the other mode never accepts`);
  lines.push("");
  lines.push("accepted cells (fixture / key / keyId / tenant / pss):");
  for (const cell of report.cells.filter((entry) => entry.verdict === "PASS")) {
    lines.push(`  ${cell.fixtureId.padEnd(16)} ${cell.keyMaterial.padEnd(8)} ${cell.expectedKeyId.padEnd(8)} ${cell.tenantExpectation.padEnd(8)} ${cell.pssMode}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
