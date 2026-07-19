import { describe, it, expect } from "vitest";
import { BigQueryClient } from "../../../packages/google-cloud/src";

describe("Integration: BigQuery Ingestion", () => {
  it("streams receipt audit log rows to BigQuery ledger table", async () => {
    const bq = new BigQueryClient(true);
    await bq.insertReceiptRows([
      {
        receipt_id: "rct_0000000000000000000000000000000000000000000000000000000000000001",
        tenant_slug: "acme-corp",
        issued_at: new Date().toISOString(),
        subject_kind: "evidence-object",
        subject_id: "subj-01",
        digest_sha256: "0000000000000000000000000000000000000000000000000000000000000001",
        signature_key_id: "key-1",
        status: "issued",
        gcs_uri: "gs://ghost-ark-receipts/acme-corp/receipts/rct_1.json",
        ingested_at: new Date().toISOString()
      }
    ]);

    const results = await bq.queryReceipts("SELECT * FROM receipts WHERE tenant_slug = 'acme-corp'");
    expect(results).toHaveLength(1);
    expect(results[0].receipt_id).toBe("rct_0000000000000000000000000000000000000000000000000000000000000001");
  });
});
