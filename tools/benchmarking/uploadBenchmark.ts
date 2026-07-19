import { StorageClient } from "../../packages/google-cloud/src";

export async function runUploadBenchmark(iterations = 100) {
  const storage = new StorageClient(true);
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await storage.upload({
      bucket: "bench-bucket",
      objectPath: `bench-${i}.json`,
      data: JSON.stringify({ item: i }),
      tenantSlug: "acme-bench"
    });
  }
  const elapsedMs = Date.now() - start;
  return { iterations, elapsedMs, opsPerSec: (iterations / elapsedMs) * 1000 };
}
