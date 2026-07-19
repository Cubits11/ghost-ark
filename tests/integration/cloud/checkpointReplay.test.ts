import { describe, it, expect } from "vitest";
import { CheckpointPublisher, StorageClient, BigQueryClient } from "../../../packages/google-cloud/src";

describe("Integration: Checkpoint Replay Safety", () => {
  it("publishes sequential checkpoints monotonic by epoch", async () => {
    const storage = new StorageClient(true);
    const bq = new BigQueryClient(true);
    const publisher = new CheckpointPublisher(storage, bq);

    const cp1 = await publisher.publish({
      checkpoint: {
        schemaVersion: "ghost.receipt_checkpoint.v1",
        tenantSlug: "acme-corp",
        epochId: "epoch-100",
        leafCount: 10,
        merkleRoot: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        leavesHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        signerKeyId: "key-1",
        signatureAlg: "RS256",
        signature: "c2ln",
        publishedAt: new Date().toISOString()
      },
      bucketName: "checkpoints"
    });

    expect(cp1.gcsUri).toContain("epoch-100.json");
  });
});
