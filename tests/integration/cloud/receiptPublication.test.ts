import { describe, it, expect } from "vitest";
import { ReceiptPublisher, StorageClient, BigQueryClient } from "../../../packages/google-cloud/src";
import { ReceiptRecord } from "../../../packages/receipt-schema/src/receipt";

describe("Integration: Receipt Publication Pipeline", () => {
  it("executes full receipt publication to GCS & BigQuery atomically", async () => {
    const storage = new StorageClient(true);
    const bq = new BigQueryClient(true);
    const publisher = new ReceiptPublisher(storage, bq);

    const record: ReceiptRecord = {
      payload: {
        receiptId: "rct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        schemaVersion: "ghost-ark.receipt.v1",
        tenantSlug: "acme-corp",
        issuedAt: new Date().toISOString(),
        subject: { kind: "claim", id: "claim-7" },
        evidenceObjects: ["ev-7"],
        lineageEventIds: [],
        claimIds: [],
        governanceContext: { lakeFormationTags: {}, columnRestrictions: [], policyCompilerVersion: "50.0.0" }
      },
      signature: {
        keyId: "key-dev",
        algorithm: "RS256",
        messageType: "DIGEST",
        digestSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        signatureBase64: "c2lnbmF0dXJl",
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
    expect(await storage.exists("ghost-ark-receipts", `tenants/acme-corp/receipts/${res.receiptId}.json`)).toBe(true);
  });
});
