import { buildReceiptPayload } from "../../packages/receipt-schema/src/receipt";

export async function runReceiptGenerationBenchmark(iterations = 500) {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    buildReceiptPayload({
      tenantSlug: "acme-bench",
      subject: { kind: "evidence-object", id: `bench-${i}` },
      evidenceObjects: ["ev-1"],
      governanceContext: { lakeFormationTags: {}, columnRestrictions: [], policyCompilerVersion: "50.0.0" }
    });
  }
  const elapsedMs = Date.now() - start;
  return { iterations, elapsedMs, opsPerSec: (iterations / elapsedMs) * 1000 };
}
