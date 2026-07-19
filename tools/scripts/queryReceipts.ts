import { BigQueryClient } from "../../packages/google-cloud/src";

export async function queryReceiptsScript(querySql: string) {
  const bq = new BigQueryClient(true);
  return bq.queryReceipts(querySql);
}
