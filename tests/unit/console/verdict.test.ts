import { describe, expect, it } from "vitest";
import { evaluateReceiptVerdict } from "../../../apps/console/src/verdict";
import type { VerifierBadges } from "../../../apps/console/src/mockData";

function badges(overrides: Partial<VerifierBadges> = {}): VerifierBadges {
  return {
    digestRecomputed: true,
    signatureValid: true,
    merklePathValid: true,
    keyIdImmutable: true,
    manifestAuthenticated: true,
    epochValid: true,
    timeAnchored: true,
    ...overrides,
  };
}

const allNull: VerifierBadges = {
  digestRecomputed: null,
  signatureValid: null,
  merklePathValid: null,
  keyIdImmutable: null,
  manifestAuthenticated: null,
  epochValid: null,
  timeAnchored: null,
};

describe("evaluateReceiptVerdict", () => {
  it("verifies only when every critical check is true", () => {
    const result = evaluateReceiptVerdict(badges());
    expect(result.verdict).toBe("verified");
    expect(result.attests.some((a) => a.includes("signing key authorized"))).toBe(true);
  });

  it("marks a failed critical check compromised and does NOT claim signing authority", () => {
    const result = evaluateReceiptVerdict(badges({ manifestAuthenticated: false }));
    expect(result.verdict).toBe("compromised");
    expect(result.failing.map((f) => f.key)).toContain("manifestAuthenticated");
    // The overclaim the adversarial review caught: compromised must not assert authorization.
    expect(result.attests.some((a) => a.includes("signing key authorized"))).toBe(false);
    expect(result.attests.join(" ")).toContain("Nothing can be relied upon");
  });

  it("treats a null critical as NOT verified (incomplete, not verified)", () => {
    const result = evaluateReceiptVerdict(badges({ timeAnchored: null }));
    expect(result.verdict).toBe("incomplete");
    expect(result.unevaluated.map((u) => u.key)).toContain("timeAnchored");
    expect(result.attests.some((a) => a.includes("signing key authorized"))).toBe(false);
  });

  it("never lets a false badge leak into verified", () => {
    const result = evaluateReceiptVerdict(badges({ timeAnchored: false, epochValid: null }));
    expect(result.verdict).toBe("compromised");
  });

  it("reports documentation_only only when all criticals are null", () => {
    expect(evaluateReceiptVerdict(allNull).verdict).toBe("documentation_only");
  });
});
