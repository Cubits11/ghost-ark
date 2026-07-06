import { S3Event } from "aws-lambda";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requiredEnv } from "../../../../packages/shared/src/config";
import { canonicalSha256Hex, canonicalize } from "../../../../packages/receipt-schema/src/hashCanonicalization";

const s3 = new S3Client({});

export async function handler(event: S3Event): Promise<{ transformed: number }> {
  const outputBucket = requiredEnv("CURATED_BUCKET");
  let transformed = 0;
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/gu, " "));
    const match = key.match(/^tenants\/([^/]+)\/raw\//u);
    if (!match) {
      throw new Error(`Object is outside tenant raw namespace: ${key}`);
    }
    const tenantSlug = match[1];
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await response.Body?.transformToString();
    if (!body) {
      throw new Error(`No object body for s3://${bucket}/${key}`);
    }
    const parsed = key.endsWith(".json") ? JSON.parse(body) : { rawText: body };
    const canonical = canonicalize({ tenantSlug, parsed });
    const digest = canonicalSha256Hex(canonical);
    await s3.send(
      new PutObjectCommand({
        Bucket: outputBucket,
        Key: `tenants/${tenantSlug}/curated/lightweight/${digest}.json`,
        ContentType: "application/json",
        Body: canonical
      })
    );
    transformed += 1;
  }
  return { transformed };
}
