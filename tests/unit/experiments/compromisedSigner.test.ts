import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPROMISED_FIXTURES, generateCompromisedFixtures } from "../../../tools/experiments/generateCompromisedSignerFixtures";
import { runE4Guard } from "../../../tools/experiments/e4MetamorphicGuard";
import { runE3Detection } from "../../../tools/experiments/e3CorpusDetection";
import { canonicalize, sha256Hex } from "../../../packages/receipt-schema/src/hashCanonicalization";

const REPO_ROOT = resolve(__dirname, "../../..");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const HMAC_TEST_VECTOR = "ghost-ark-repro-signing-dev-only-test-vector-v1";

function readFixture(attackId: string, attackName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(CORPUS_DIR, "receipts", `${attackId}.${attackName}.receipt.json`), "utf8")) as Record<string, unknown>;
}

/**
 * E4-B: the compromised-signer adversary. These fixtures carry signatures that are GENUINELY
 * VALID over a mutated payload, which is what makes them able to isolate checks that every
 * previous fixture short-circuited past.
 *
 * The most important assertion in this file is not that the fixtures are rejected — two of
 * them are deliberately ACCEPTED. It is that their signatures really do verify. A fixture
 * whose signature was merely broken would isolate nothing and would silently reduce to the
 * pre-existing corpus.
 */
describe("E4-B fixtures carry genuinely valid signatures over mutated payloads", () => {
  it("recomputes the envelope digest and HMAC correctly for every generated fixture", () => {
    for (const spec of COMPROMISED_FIXTURES) {
      const receipt = readFixture(spec.attackId, spec.attackName);

      const { receipt_signature: encodedEnvelope, ...unsigned } = receipt;
      const envelope = JSON.parse(Buffer.from(encodedEnvelope as string, "base64url").toString("utf8")) as {
        digestSha256: string;
        signature: string;
      };

      const canonicalPayload = canonicalize(unsigned);

      // The digest in the envelope must match the payload as presented. This is the assertion
      // that proves the compromised signer actually re-signed, rather than leaving a stale
      // envelope that would fail for the ordinary reason.
      expect(envelope.digestSha256, `${spec.attackId} envelope digest is stale`).toBe(sha256Hex(canonicalPayload));

      // And the HMAC must verify over those same bytes.
      const expectedSignature = createHmac("sha256", HMAC_TEST_VECTOR).update(canonicalPayload).digest("base64");
      expect(envelope.signature, `${spec.attackId} signature does not verify over its own payload`).toBe(expectedSignature);
    }
  });

  it("is byte-reproducible from the generator", () => {
    // The fixtures are checked in. If regenerating them produced different bytes, the
    // committed corpus and the generator would have drifted and neither could be trusted.
    for (const generated of generateCompromisedFixtures()) {
      const onDisk = readFixture(generated.spec.attackId, generated.spec.attackName);
      expect(onDisk, `${generated.spec.attackId} on disk differs from the generator output`).toEqual(generated.receipt);
    }
  });

  it("keeps receipt_id INCONSISTENT only where that is the isolation target", () => {
    for (const spec of COMPROMISED_FIXTURES) {
      const receipt = readFixture(spec.attackId, spec.attackName);
      const { receipt_signature: _envelope, receipt_id: declaredId, ...withoutId } = receipt;
      const recomputed = `grct_${sha256Hex(canonicalize(withoutId))}`;

      if (spec.recomputeReceiptId) {
        expect(recomputed, `${spec.attackId} should have a consistent receipt_id`).toBe(declaredId);
      } else {
        expect(recomputed, `${spec.attackId} should have an INCONSISTENT receipt_id`).not.toBe(declaredId);
      }
    }
  });

  it("uses a published dev-only test vector, never a credential", () => {
    // Guards against a future edit that swaps in something real. The vector is published in
    // examples/reproducibility/manifest.json and local HMAC signing is dev-only by design.
    expect(HMAC_TEST_VECTOR).toContain("dev-only");
    const manifest = readFileSync(resolve(REPO_ROOT, "examples/reproducibility/manifest.json"), "utf8");
    expect(manifest).toContain(HMAC_TEST_VECTOR);
  });
});

describe("E4-B closes the check-isolation gap E4 identified", () => {
  it("makes receipt_id load-bearing, which the previous corpus could not", async () => {
    const report = await runE4Guard();

    // Before MAL-027 this check flipped zero attacks: every receipt_id mutation also broke the
    // digest and signature, so the verifier short-circuited and neutering receipt_id changed
    // nothing. A validly-signed inconsistent id isolates it.
    expect(report.loadBearingChecks).toContain("receipt_id");
    const receiptIdMutant = report.mutants.find((mutant) => mutant.mutatedCheck === "receipt_id");
    expect(receiptIdMutant?.flippedToUndetected).toContain("MAL-027");
  }, 240_000);

  it("makes tenant_expectation load-bearing via a validly-signed cross-tenant receipt", async () => {
    const report = await runE4Guard();
    expect(report.loadBearingChecks).toContain("tenant_expectation");
    const mutant = report.mutants.find((mutant) => mutant.mutatedCheck === "tenant_expectation");
    expect(mutant?.flippedToUndetected).toContain("MAL-028");
  }, 240_000);

  it("accounts for every one of the ten checks", async () => {
    const report = await runE4Guard();

    // The honest exit condition. Not "10/10 isolated" — that target is unreachable, because
    // two checks do not inspect receipts at all. Every check must be in exactly one bucket.
    const accounted = report.loadBearingChecks.length + report.noDependentFixtures.length + report.notFixtureIsolable.length;
    expect(accounted).toBe(10);
    expect(report.loadBearingChecks.length).toBeGreaterThanOrEqual(7);
  }, 240_000);

  it("classifies configuration and canonical_payload as principled limits, not gaps", async () => {
    const report = await runE4Guard();

    // configuration inspects the verifier's own options; canonical_payload rejects non-JSON
    // host values that JSON.parse cannot produce. Neither is reachable from a receipt file, so
    // reporting them as corpus gaps to be closed would be misleading.
    expect(report.notFixtureIsolable).toContain("configuration");
    expect(report.notFixtureIsolable).toContain("canonical_payload");
    expect(report.noDependentFixtures).not.toContain("configuration");
    expect(report.noDependentFixtures).not.toContain("canonical_payload");
  }, 240_000);

  it("still reports the remaining genuine gap rather than declaring victory", async () => {
    const report = await runE4Guard();
    // `tenant` belongs to the RECORD-receipt path (rct_), and the corpus contains no record
    // receipts. That is a real coverage gap and stays reported as one.
    expect(report.noDependentFixtures).toContain("tenant");
  }, 240_000);

  it("keeps the tautology verdict PASS with the new fixtures present", async () => {
    const report = await runE4Guard();
    // Adding fixtures that PASS by design must not weaken the tautology discriminator.
    expect(report.tautology_verdict).toMatch(/^PASS/u);
  }, 240_000);

  it("keeps every mutant's control arm intact", async () => {
    const report = await runE4Guard();
    for (const mutant of report.mutants) {
      expect(mutant.controlArmIntact, `control arm broken by mutant ${String(mutant.mutatedCheck)}`).toBe(true);
    }
  }, 240_000);
});

describe("E4-B documents two non-detections instead of hiding them", () => {
  it("accepts a validly-signed backdated receipt, because no freshness policy exists", async () => {
    const report = await runE3Detection();
    const backdated = report.outcomes.find((outcome) => outcome.attack_id === "MAL-029");

    // This is the point of the fixture. The verifier implements no freshness check, so a
    // validly-signed backdated receipt is indistinguishable from a genuine one. Asserting the
    // PASS makes the boundary explicit and would fail loudly if someone later claimed
    // freshness was covered without implementing it.
    expect(backdated?.verdict).toBe("PASS");
  }, 240_000);

  it("accepts a validly-signed decision escalation, because signing is not truth", async () => {
    const report = await runE3Detection();
    const escalated = report.outcomes.find((outcome) => outcome.attack_id === "MAL-030");

    // The sharpest statement of what a receipt is NOT: under a compromised signer, a receipt
    // can attest that a REFUSE was an ALLOW and remain cryptographically flawless.
    expect(escalated?.verdict).toBe("PASS");
  }, 240_000);

  it("records the claim boundary for every documented non-detection", () => {
    const manifest = JSON.parse(readFileSync(resolve(CORPUS_DIR, "manifest.json"), "utf8")) as {
      attacks: { attack_id: string; expected_verdict: string; claim_boundary: string }[];
    };

    const documented = manifest.attacks.filter((attack) => attack.expected_verdict === "accept_documented_boundary");
    expect(documented.length).toBeGreaterThanOrEqual(2);
    for (const attack of documented) {
      // A fixture that is expected to pass MUST carry an explanation, or it is indistinguishable
      // from a test someone forgot to make strict.
      expect(attack.claim_boundary.length, `${attack.attack_id} has no claim boundary`).toBeGreaterThan(80);
    }
  });
});
