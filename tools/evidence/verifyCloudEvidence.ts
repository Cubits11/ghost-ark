import { StorageClient } from "../../packages/google-cloud/src";
import { createHash } from "crypto";

export interface VerifyCloudEvidenceArgs {
  bucketName: string;
  objectPath: string;
  expectedSha256: string;
}

export async function verifyCloudEvidenceCli(args: VerifyCloudEvidenceArgs): Promise<boolean> {
  const storageClient = new StorageClient(true);
  const exists = await storageClient.exists(args.bucketName, args.objectPath);
  if (!exists) return false;

  const obj = await storageClient.download(args.bucketName, args.objectPath);
  const actualHash = createHash("sha256").update(obj.data).digest("hex");
  return actualHash === args.expectedSha256;
}
