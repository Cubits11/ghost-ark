import { BigQueryClient } from "../../packages/google-cloud/src";

export async function listReceiptsScript(tenantSlug: string) {
  const bq = new BigQueryClient(true);
  const rows = await bq.queryReceipts(`SELECT * FROM receipts WHERE tenant_slug = '${tenantSlug}'`);
  console.log(`[Script] Found ${rows.length} receipts for tenant ${tenantSlug}`);
  return rows;
}
