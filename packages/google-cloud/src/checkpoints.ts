import { StorageClient } from "./storage";
import { BigQueryClient } from "./bigquery";
import { CloudStorageManifest } from "./schema";

export interface CheckpointRecord {
  schemaVersion: "ghost.receipt_checkpoint.v1";
  tenantSlug: string;
  epochId: string;
  leafCount: number;
  merkleRoot: string;
  leavesHash: string;
  signerKeyId: string;
  signatureAlg: string;
  signature: string;
  publishedAt: string;
}

export interface PublishCheckpointInput {
  checkpoint: CheckpointRecord;
  bucketName: string;
}

export class CheckpointPublisher {
  constructor(
    private readonly storageClient: StorageClient,
    private readonly bigQueryClient: BigQueryClient
  ) {}

  async publish(input: PublishCheckpointInput): Promise<{ gcsUri: string; manifest: CloudStorageManifest }> {
    const { checkpoint, bucketName } = input;
    const objectPath = `tenants/${checkpoint.tenantSlug}/checkpoints/${checkpoint.epochId}.json`;
    const jsonStr = JSON.stringify(checkpoint, null, 2);

    const manifest = await this.storageClient.upload({
      bucket: bucketName,
      objectPath,
      data: jsonStr,
      contentType: "application/json",
      tenantSlug: checkpoint.tenantSlug
    });

    const gcsUri = `gs://${bucketName}/${objectPath}`;
    return { gcsUri, manifest };
  }
}
