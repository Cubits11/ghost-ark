import { describe, it, expect } from "vitest";
import { StorageClient } from "../../packages/google-cloud/src";
import { ReceiptRecord } from "../../packages/receipt-schema/src/receipt";

describe("Differential Test: Receipt Serialization Round-Trip", () => {
  it("preserves exact canonical json representation across GCS upload and download", async () => {
    const storage = new StorageClient(true);
    const record: ReceiptRecord = {
      payload: {
        receiptId: "rct_9999999999999999999999999999999999999999999999999999999999999999",
        schemaVersion: "ghost-ark.receipt.v1",
        tenantSlug: "acme-corp",
        issuedAt: "2026-07-19T20:00:00.000Z",
        subject: { kind: "claim", id: "claim-99" },
        evidenceObjects: ["ev-99"],
        lineageEventIds: [],
        claimIds: [],
        governanceContext: { lakeFormationTags: {}, columnRestrictions: [], policyCompilerVersion: "50.0.0" }
      },
      signature: {
        keyId: "key-dev",
        algorithm: "RS256",
        messageType: "DIGEST",
        digestSha256: "9999999999999999999999999999999999999999999999999999999999999999",
        signatureBase64: "dGVzdA==",
        signedAt: "2026-07-19T20:00:00.000Z"
      },
      status: "issued",
      createdAt: "2026-07-19T20:00:00.000Z",
      updatedAt: "2026-07-19T20:00:00.000Z"
    };

    const originalJson = JSON.stringify(record, null, 2);
    await storage.upload({
      bucket: "roundtrip-bucket",
      objectPath: "receipts/rct_99.json",
      data: originalJson,
      tenantSlug: "acme-corp"
    });

    const downloadedObj = await storage.download("roundtrip-bucket", "receipts/rct_99.json");
    const downloadedRecord: ReceiptRecord = JSON.parse(downloadedObj.data.toString("utf-8"));

    expect(downloadedRecord.payload.receiptId).toBe(record.payload.receiptId);
    expect(downloadedRecord.signature.digestSha256).toBe(record.signature.digestSha256);
  });
});
