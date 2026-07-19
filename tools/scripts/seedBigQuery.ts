import { BigQueryClient } from "../../packages/google-cloud/src";

export async function seedBigQueryScript() {
  const bq = new BigQueryClient(true);
  await bq.insertReceiptRows([
    {
      receipt_id: "rct_0000000000000000000000000000000000000000000000000000000000000100",
      tenant_slug: "acme-seed",
      issued_at: new Date().toISOString(),
      subject_kind: "claim",
      subject_id: "seed-claim-1",
      digest_sha256: "0000000000000000000000000000000000000000000000000000000000000100",
      signature_key_id: "key-seed",
      status: "issued",
      gcs_uri: "gs://ghost-ark-receipts/acme-seed/receipts/rct_100.json",
      ingested_at: new Date().toISOString()
    }
  ]);
  console.log("[Script] Seeded sample receipt into BigQuery mock table.");
}

if (require.main === module) {
  seedBigQueryScript().catch(console.error);
}
