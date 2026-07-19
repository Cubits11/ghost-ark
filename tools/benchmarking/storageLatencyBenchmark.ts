import { StorageClient } from "../../packages/google-cloud/src";

export async function runStorageLatencyBenchmark(iterations = 50) {
  const storage = new StorageClient(true);
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = Date.now();
    await storage.upload({
      bucket: "latency-bench",
      objectPath: `obj-${i}.bin`,
      data: Buffer.from("hello"),
      tenantSlug: "acme-bench"
    });
    latencies.push(Date.now() - t0);
  }

  const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  return { iterations, avgMs, minMs: Math.min(...latencies), maxMs: Math.max(...latencies) };
}
