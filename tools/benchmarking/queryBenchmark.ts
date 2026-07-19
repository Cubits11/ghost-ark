import { BigQueryClient } from "../../packages/google-cloud/src";

export async function runQueryBenchmark(iterations = 100) {
  const bq = new BigQueryClient(true);
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await bq.queryReceipts("SELECT * FROM receipts WHERE tenant_slug = 'acme-bench'");
  }
  const elapsedMs = Date.now() - start;
  return { iterations, elapsedMs, opsPerSec: (iterations / elapsedMs) * 1000 };
}
