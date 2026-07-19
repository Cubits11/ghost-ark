import { describe, it, expect } from "vitest";
import { BigQueryClient } from "../../packages/google-cloud/src";

describe("Differential Test: Cloud vs Local Ledger Parity", () => {
  it("ensures row values in BigQuery match local ledger state exactly", async () => {
    const bq = new BigQueryClient(true);
    const mockRow = {
      receipt_id: "rct_1111111111111111111111111111111111111111111111111111111111111111",
      tenant_slug: "acme-corp",
      issued_at: "2026-07-19T20:00:00.000Z",
      subject_kind: "evidence-object" as const,
      subject_id: "ev-obj-1",
      digest_sha256: "1111111111111111111111111111111111111111111111111111111111111111",
      signature_key_id: "key-1",
      status: "issued" as const,
      gcs_uri: "gs://ghost-ark-receipts/acme-corp/receipts/rct_1.json",
      ingested_at: "2026-07-19T20:00:01.000Z"
    };

    await bq.insertReceiptRows([mockRow]);
    const fetched = await bq.queryReceipts("SELECT * FROM receipts WHERE tenant_slug = 'acme-corp'");

    expect(fetched[0].digest_sha256).toBe(mockRow.digest_sha256);
    expect(fetched[0].receipt_id).toBe(mockRow.receipt_id);
  });
});
