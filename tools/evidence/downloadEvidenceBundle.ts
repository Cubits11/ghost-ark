import { StorageClient, EvidenceBundleManager } from "../../packages/google-cloud/src";

export interface DownloadBundleCliArgs {
  bucketName: string;
  objectPath: string;
  expectedSha256: string;
}

export async function downloadEvidenceBundleCli(args: DownloadBundleCliArgs): Promise<Buffer> {
  const storageClient = new StorageClient(true);
  const manager = new EvidenceBundleManager(storageClient);

  return manager.downloadAndVerify(args.bucketName, args.objectPath, args.expectedSha256);
}
