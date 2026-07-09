import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ExpectedDigests,
  REPRO_REPORT_SCHEMA_VERSION,
  loadReproManifest
} from "../../../tools/repro/manifest";
import { verifyReproManifest } from "../../../tools/repro/verify-repro-manifest";

const MANIFEST_PATH = "examples/reproducibility/manifest.json";

describe("receipt reproducibility fixtures", () => {
  it("verifies every committed fixture end-to-end with a passing verdict", async () => {
    const report = await verifyReproManifest(MANIFEST_PATH);

    expect(report.schema_version).toBe(REPRO_REPORT_SCHEMA_VERSION);
    expect(report.verdict).toBe("PASS");
    expect(report.fixture_count).toBe(3);
    expect(report.fixtures.map((fixture) => fixture.fixture_id)).toEqual(["hmac-baseline", "hmac-chained", "kms-style-rsa"]);

    for (const fixture of report.fixtures) {
      expect(fixture.verdict).toBe("PASS");
      for (const check of fixture.checks) {
        expect(check.passed, `${fixture.fixture_id}:${check.name} — ${check.detail}`).toBe(true);
      }
    }
  });

  it("asserts receipt_id and digestSha256 stability against expected-digests.json", async () => {
    const { manifest, baseDir } = loadReproManifest(MANIFEST_PATH);
    const expected = JSON.parse(readFileSync(join(baseDir, manifest.expected_digests_path), "utf8")) as ExpectedDigests;

    for (const fixture of manifest.fixtures) {
      const committed = JSON.parse(readFileSync(join(baseDir, fixture.paths.receipt), "utf8")) as {
        receipt_id: string;
      };
      const expectations = expected.fixtures[fixture.fixture_id];
      expect(expectations, `expected digests recorded for ${fixture.fixture_id}`).toBeDefined();
      expect(committed.receipt_id).toBe(expectations.receipt_id);
      expect(expectations.digest_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(expectations.signed_receipt_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });

  it("decodes every committed signature envelope strictly", async () => {
    const report = await verifyReproManifest(MANIFEST_PATH);
    for (const fixture of report.fixtures) {
      const envelopeCheck = fixture.checks.find((check) => check.name === "envelope_strict_decode");
      expect(envelopeCheck, `${fixture.fixture_id} has an envelope_strict_decode check`).toBeDefined();
      expect(envelopeCheck?.passed).toBe(true);

      const bindingCheck = fixture.checks.find((check) => check.name === "envelope_digest_binding");
      expect(bindingCheck?.passed).toBe(true);
    }
  });

  it("produces a deterministic report across repeated runs", async () => {
    const first = await verifyReproManifest(MANIFEST_PATH);
    const second = await verifyReproManifest(MANIFEST_PATH);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("carries the reproducibility non-claim in the report", async () => {
    const report = await verifyReproManifest(MANIFEST_PATH);
    expect(report.non_claim).toContain("does not prove model safety");
    expect(report.non_claim).toContain("Ghost-Ark verifier rules");
  });
});
