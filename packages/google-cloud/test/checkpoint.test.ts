import { describe, it, expect } from "vitest";
import { StorageClient } from "../src/storage";
import { BigQueryClient } from "../src/bigquery";
import { CheckpointPublisher, CheckpointRecord } from "../src/checkpoints";

describe("CheckpointPublisher", () => {
  it("publishes checkpoint to GCS", async () => {
    const storageClient = new StorageClient(true);
    const bigQueryClient = new BigQueryClient(true);
    const publisher = new CheckpointPublisher(storageClient, bigQueryClient);

    const checkpoint: CheckpointRecord = {
      schemaVersion: "ghost.receipt_checkpoint.v1",
      tenantSlug: "acme-corp",
      epochId: "epoch-001",
      leafCount: 42,
      merkleRoot: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      leavesHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      signerKeyId: "key-checkpoint-1",
      signatureAlg: "RS256",
      signature: "dGVzdC1zaWduYXR1cmU=",
      publishedAt: new Date().toISOString()
    };

    const res = await publisher.publish({
      checkpoint,
      bucketName: "ghost-ark-checkpoints"
    });

    expect(res.gcsUri).toContain("epoch-001.json");
    expect(res.manifest.tenantSlug).toBe("acme-corp");
  });
});
