import { EvidenceBundleManager, StorageClient } from "../../../../packages/google-cloud/src";

export async function handleUploadEvidence(evidenceId: string, tenantSlug: string, bucketName: string, data: Buffer) {
  const storage = new StorageClient(true);
  const manager = new EvidenceBundleManager(storage);

  return manager.uploadBundle({
    evidenceId,
    tenantSlug,
    bucketName,
    data
  });
}
