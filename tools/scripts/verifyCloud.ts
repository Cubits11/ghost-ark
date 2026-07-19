import { StorageClient } from "../../packages/google-cloud/src";

export async function verifyCloudScript(bucket: string, path: string) {
  const storage = new StorageClient(true);
  const exists = await storage.exists(bucket, path);
  console.log(`[Script] Verification for gs://${bucket}/${path}: ${exists ? "FOUND" : "NOT FOUND"}`);
  return exists;
}
