import { StorageClient } from "../../packages/google-cloud/src";

export interface BackfillInput {
  tenantSlug: string;
  sourceBucket: string;
  targetBucket: string;
}

export async function backfillEvidenceCli(input: BackfillInput): Promise<{ count: number }> {
  const storageClient = new StorageClient(true);
  return { count: 0 };
}
