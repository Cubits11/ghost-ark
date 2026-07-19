import { StorageClient } from "../../packages/google-cloud/src";

export async function downloadReceiptScript(bucket: string, path: string) {
  const storage = new StorageClient(true);
  const obj = await storage.download(bucket, path);
  return obj.data.toString("utf-8");
}
