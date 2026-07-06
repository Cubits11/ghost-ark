import { describe, expect, it } from "vitest";
import { canonicalSha256Hex, canonicalize } from "../../../packages/receipt-schema/src/hashCanonicalization";
import { buildReceiptPayload, receiptDigest } from "../../../packages/receipt-schema/src/receipt";

describe("canonicalization", () => {
  it("orders object keys deterministically", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalSha256Hex({ b: 2, a: 1 })).toBe(canonicalSha256Hex({ a: 1, b: 2 }));
  });

  it("builds stable receipt IDs for identical payload inputs", () => {
    const input = {
      tenantSlug: "acme-lab",
      subject: { kind: "dataset-version" as const, id: "dataset-a" },
      evidenceObjects: ["ev_b", "ev_a"],
      governanceContext: { lakeFormationTags: { tenant_slug: "acme-lab" }, columnRestrictions: [], policyCompilerVersion: "50.0.0" },
      issuedAt: "2026-07-06T12:00:00.000Z"
    };
    const first = buildReceiptPayload(input);
    const second = buildReceiptPayload({ ...input, evidenceObjects: ["ev_a", "ev_b"] });
    expect(first.receiptId).toBe(second.receiptId);
    expect(receiptDigest(first)).toMatch(/^[a-f0-9]{64}$/u);
  });
});
