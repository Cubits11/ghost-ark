import { describe, expect, it } from "vitest";
import { buildReceiptPayload } from "../../../packages/receipt-schema/src/receipt";
import { digestPayloadForSigning } from "../../../services/signing/kms/signer";

describe("KMS signer helpers", () => {
  it("digests validated canonical receipt payloads", () => {
    const payload = buildReceiptPayload({
      tenantSlug: "acme-lab",
      issuedAt: "2026-07-06T12:00:00.000Z",
      subject: { kind: "dataset-version", id: "curated-oil" },
      evidenceObjects: ["ev_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      governanceContext: {
        lakeFormationTags: { tenant_slug: "acme-lab", classification: "internal" },
        columnRestrictions: [],
        policyCompilerVersion: "50.0.0"
      }
    });
    const digest = digestPayloadForSigning(payload);
    expect(digest.digest).toHaveLength(32);
    expect(digest.digestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest.canonicalPayload).toContain('"receiptId"');
  });
});
