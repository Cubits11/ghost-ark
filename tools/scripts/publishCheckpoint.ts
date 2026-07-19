import { CheckpointPublisher, StorageClient, BigQueryClient } from "../../packages/google-cloud/src";

export async function publishCheckpointScript(tenantSlug: string, epochId: string, merkleRoot: string) {
  const storage = new StorageClient(true);
  const bq = new BigQueryClient(true);
  const publisher = new CheckpointPublisher(storage, bq);

  return publisher.publish({
    checkpoint: {
      schemaVersion: "ghost.receipt_checkpoint.v1",
      tenantSlug,
      epochId,
      leafCount: 1,
      merkleRoot,
      leavesHash: merkleRoot,
      signerKeyId: "key-1",
      signatureAlg: "RS256",
      signature: "sig",
      publishedAt: new Date().toISOString()
    },
    bucketName: "checkpoints"
  });
}
