import { BigQueryClient, BigQueryReceiptRow } from "../../../../packages/google-cloud/src";

export async function handlePublishBigQuery(rows: BigQueryReceiptRow[]) {
  const bq = new BigQueryClient(true);
  await bq.insertReceiptRows(rows);
  return { published: rows.length };
}
