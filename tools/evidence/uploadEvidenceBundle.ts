import { StorageClient, EvidenceBundleManager } from "../../packages/google-cloud/src";

export interface UploadBundleCliArgs {
  evidenceId: string;
  tenantSlug: string;
  bucketName: string;
  data: string | Buffer;
  contentType?: string;
}

export async function uploadEvidenceBundleCli(args: UploadBundleCliArgs) {
  const storageClient = new StorageClient(true);
  const manager = new EvidenceBundleManager(storageClient);

  const payload = await manager.uploadBundle({
    evidenceId: args.evidenceId,
    tenantSlug: args.tenantSlug,
    bucketName: args.bucketName,
    data: args.data,
    contentType: args.contentType
  });

  return payload;
}
