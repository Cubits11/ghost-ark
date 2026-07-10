import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkClaim,
  checkRegistry,
  computeArtifactDigest,
  CLAIM_REGISTRY_SCHEMA_VERSION,
} from "../../../tools/claims/claimRegistry.mjs";

const ROOT = resolve(__dirname, "../../..");
const VERIFIER_FIXTURE = "tools/claims/fixtures/receipt-verifier.artifact.txt";
const verifierDigest = computeArtifactDigest(resolve(ROOT, VERIFIER_FIXTURE));

describe("structured claim registry", () => {
  it("admits a claim whose asserted level is within its bound evidence", () => {
    const result = checkClaim(
      {
        id: "CLM-OK",
        statement: "verifier recomputes receipt identity",
        asserts_level: 6,
        cites: [{ path: VERIFIER_FIXTURE, expect_sha256: verifierDigest, supports_level: 6 }],
      },
      ROOT,
    );
    expect(result.ok).toBe(true);
    expect(result.supported_level).toBe(6);
  });

  it("rejects an overclaim (asserted level exceeds supported level)", () => {
    const result = checkClaim(
      {
        id: "CLM-OVERCLAIM",
        statement: "verifier proves production readiness",
        asserts_level: 9,
        cites: [{ path: VERIFIER_FIXTURE, expect_sha256: verifierDigest, supports_level: 6 }],
      },
      ROOT,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("overclaim"))).toBe(true);
  });

  it("rejects a cite-then-mutate: digest binding is broken", () => {
    const result = checkClaim(
      {
        id: "CLM-TAMPER",
        statement: "verifier recomputes receipt identity",
        asserts_level: 6,
        cites: [{ path: VERIFIER_FIXTURE, expect_sha256: "0".repeat(64), supports_level: 6 }],
      },
      ROOT,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("digest mismatch"))).toBe(true);
  });

  it("fails closed when a cited artifact does not exist", () => {
    const result = checkClaim(
      {
        id: "CLM-MISSING",
        statement: "cites a phantom",
        asserts_level: 2,
        cites: [{ path: "tools/claims/fixtures/does-not-exist.txt", expect_sha256: "a".repeat(64), supports_level: 8 }],
      },
      ROOT,
    );
    expect(result.ok).toBe(false);
    expect(result.supported_level).toBe(-1);
  });

  it("takes the MINIMUM supported level across multiple citations", () => {
    const liveAws = "tools/claims/fixtures/live-aws.artifact.txt";
    const liveDigest = computeArtifactDigest(resolve(ROOT, liveAws));
    const result = checkClaim(
      {
        id: "CLM-MIN",
        statement: "spans two artifacts",
        asserts_level: 5, // exceeds the weaker (level 4) citation
        cites: [
          { path: VERIFIER_FIXTURE, expect_sha256: verifierDigest, supports_level: 6 },
          { path: liveAws, expect_sha256: liveDigest, supports_level: 4 },
        ],
      },
      ROOT,
    );
    expect(result.supported_level).toBe(4);
    expect(result.ok).toBe(false);
  });

  it("admits the committed sample registry", () => {
    const registry = JSON.parse(readFileSync(resolve(ROOT, "tools/claims/registry.sample.json"), "utf8"));
    expect(registry.schema_version).toBe(CLAIM_REGISTRY_SCHEMA_VERSION);
    const results = checkRegistry(registry, ROOT);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
