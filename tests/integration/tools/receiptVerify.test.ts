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

  it("fails before signature verification when the stored digest is tampered", async () => {
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

  it("fails before signature verification when the payload is tampered after signing", async () => {
    const record = buildRecord();
    let signatureVerifierCalled = false;

    record.payload.subject.id = "tampered-dataset-version";

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => {
        signatureVerifierCalled = true;
        return true;
      }
    });

    expect(result.verdict).toBe(false);
    expect(signatureVerifierCalled).toBe(false);
    expect(result.checks.find((check) => check.name === "receiptId")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the signature verifier rejects the signature", async () => {
    const record = buildRecord();

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => false
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "schema")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "receiptId")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails schema validation for malformed receipt records", async () => {
    const record = buildRecord();
    const malformed = {
      ...record,
      payload: {
        ...record.payload,
        receiptId: "not-a-valid-receipt-id"
      }
    };

    const result = await verifyReceiptRecord(malformed, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("schema");
    expect(result.checks[0].passed).toBe(false);
  });

  it("fails when signing metadata uses an unexpected algorithm", async () => {
    const record = buildRecord();

    record.signature.algorithm = "RSASSA_PKCS1_V1_5_SHA_256";

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "algorithm")?.passed).toBe(false);
  });
});
