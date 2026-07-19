import { BigQueryClient, BigQueryReceiptRow } from "../../packages/google-cloud/src";

export async function syncBigQueryCli(rows: BigQueryReceiptRow[]): Promise<number> {
  const bqClient = new BigQueryClient(true);
  await bqClient.insertReceiptRows(rows);
  return rows.length;
}
