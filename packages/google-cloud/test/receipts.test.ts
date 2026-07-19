import { describe, it, expect } from "vitest";
import { StorageClient } from "../src/storage";
import { BigQueryClient } from "../src/bigquery";
import { ReceiptPublisher } from "../src/receipts";
import { ReceiptRecord } from "../../receipt-schema/src/receipt";

describe("ReceiptPublisher", () => {
  it("publishes receipt record to GCS and BigQuery", async () => {
    const storageClient = new StorageClient(true);
    const bigQueryClient = new BigQueryClient(true);
    const publisher = new ReceiptPublisher(storageClient, bigQueryClient);

    const record: ReceiptRecord = {
      payload: {
        receiptId: "rct_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        schemaVersion: "ghost-ark.receipt.v1",
        tenantSlug: "acme-corp",
        issuedAt: new Date().toISOString(),
        subject: {
          kind: "evidence-object",
          id: "obj-101"
        },
        evidenceObjects: ["ev-001"],
        lineageEventIds: [],
        claimIds: [],
        governanceContext: {
          lakeFormationTags: {},
          columnRestrictions: [],
          policyCompilerVersion: "50.0.0"
        }
      },
      signature: {
        keyId: "key-dev-1",
        algorithm: "RS256",
        messageType: "DIGEST",
        digestSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        signatureBase64: "dGVzdC1zaWduYXR1cmU=",
        signedAt: new Date().toISOString()
      },
      status: "issued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const res = await publisher.publishReceipt({
      record,
      tenantSlug: "acme-corp",
      bucketName: "ghost-ark-receipts"
    });

    expect(res.receiptId).toBe(record.payload.receiptId);
    expect(res.gcsUri).toContain("ghost-ark-receipts");
    expect(res.bigQueryRow.tenant_slug).toBe("acme-corp");

    const rows = await bigQueryClient.queryReceipts("SELECT * FROM receipts WHERE tenant_slug = 'acme-corp'");
    expect(rows).toHaveLength(1);
    expect(rows[0].receipt_id).toBe(record.payload.receiptId);
  });
});
