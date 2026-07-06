#!/usr/bin/env node
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function deletePrefix(client: S3Client, bucket: string, prefix: string): Promise<number> {
  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    const objects = (listed.Contents ?? []).map((object) => ({ Key: object.Key })).filter((object) => object.Key);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
      deleted += objects.length;
    }
    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);
  return deleted;
}

async function main(): Promise<void> {
  const tenantSlug = arg("tenant");
  if (!process.argv.includes("--confirm")) {
    throw new Error("Cleanup is destructive. Re-run with --confirm after verifying tenant slug and buckets.");
  }
  const client = new S3Client({ region: arg("region", process.env.AWS_REGION ?? "us-east-1") });
  const buckets = [arg("raw-bucket"), arg("curated-bucket"), arg("export-bucket"), arg("results-bucket")];
  const results = [];
  for (const bucket of buckets) {
    results.push({ bucket, deleted: await deletePrefix(client, bucket, `tenants/${tenantSlug}/`) });
  }
  console.log(JSON.stringify({ tenantSlug, results }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
