import { StorageClient } from "../../../../packages/google-cloud/src";

export async function handleVerifyUpload(bucketName: string, objectPath: string): Promise<boolean> {
  const storage = new StorageClient(true);
  return storage.exists(bucketName, objectPath);
}
