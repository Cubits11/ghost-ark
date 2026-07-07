import { describe, expect, it } from "vitest";
import { buildReceiptPayload, ReceiptRecord, receiptDigest } from "../../../packages/receipt-schema/src/receipt";
import { verifyReceiptRecord } from "../../../tools/scripts/receiptVerify";

const now = "2026-07-07T00:00:00.000Z";

function buildRecord(): ReceiptRecord {
  const payload = buildReceiptPayload({
    tenantSlug: "acme-lab",
    issuedAt: now,
    subject: {
      kind: "dataset-version",
      id: "smoke-dataset-v1",
      uri: "s3://bucket/tenants/acme-lab/smoke.json"
    },
    evidenceObjects: ["s3://bucket/tenants/acme-lab/evidence.json"],
    lineageEventIds: [],
    claimIds: [],
    governanceContext: {
      lakeFormationTags: {
        tenant_slug: "acme-lab",
        classification: "internal",
        evidence_role: "smoke-test"
      },
      columnRestrictions: [],
      policyCompilerVersion: "50.0.0"
    },
    transform: {
      runId: "verify-test-run",
      jobName: "receipt-verify-test",
      parameters: {}
    }
  });

  return {
    payload,
    signature: {
      keyId: "alias/test",
      algorithm: "RSASSA_PSS_SHA_256",
      messageType: "DIGEST",
      digestSha256: receiptDigest(payload),
      signatureBase64: "ZmFrZS1zaWduYXR1cmU=",
      signedAt: now
    },
    status: "issued",
    createdAt: now,
    updatedAt: now
  };
}

describe("receipt verification", () => {
  it("passes for a valid receipt record when signature verifier accepts it", async () => {
    const record = buildRecord();
    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(true);
    expect(result.checks.map((check) => [check.name, check.passed])).toEqual([
      ["schema", true],
      ["tenant", true],
      ["receiptId", true],
      ["digest", true],
      ["messageType", true],
      ["algorithm", true],
      ["signature", true]
    ]);
  });

  it("fails when the expected tenant does not match the receipt tenant", async () => {
    const record = buildRecord();
    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "beta-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "tenant")?.passed).toBe(false);
  });

  it("fails before signature verification when the digest is tampered", async () => {
    const record = buildRecord();
    let signatureVerifierCalled = false;
    record.signature.digestSha256 = "0".repeat(64);

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => {
        signatureVerifierCalled = true;
        return true;
      }
    });

    expect(result.verdict).toBe(false);
    expect(signatureVerifierCalled).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });
});
