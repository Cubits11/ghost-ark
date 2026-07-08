import { S3Event } from "aws-lambda";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requiredEnv } from "../../../../packages/shared/src/config";
import { canonicalSha256Hex } from "../../../../packages/receipt-schema/src/hashCanonicalization";
import { buildLineageEvent } from "../../../../packages/lineage-model/src/events";
import { assertTrustedTenantSource } from "../../../../packages/enforcement-runtime/src/tenancy/trustedTenantSource";

const s3 = new S3Client({});

async function streamToString(body: { transformToString: () => Promise<string> }): Promise<string> {
  return await body.transformToString();
}

function parseTenant(key: string): string {
  const match = key.match(/^tenants\/([^/]+)\/raw\/cdc\//u);
  if (!match) {
    throw new Error(`CDC object is outside expected tenant namespace: ${key}`);
  }
  return match[1];
}

export async function handler(event: S3Event): Promise<{ normalized: number }> {
  const outputBucket = requiredEnv("CURATED_METADATA_BUCKET");
  let normalized = 0;
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/gu, " "));
    const tenantSlug = assertTrustedTenantSource({
      kind: "s3",
      declaredTenantSlug: parseTenant(key),
      sourceArn: record.s3.bucket.arn,
      sourceName: bucket,
      key
    });
    const source = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!source.Body) {
      throw new Error(`CDC object has no body: s3://${bucket}/${key}`);
    }
    const raw = await streamToString(source.Body);
    const rows = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const normalizedRows = rows.map((row) => ({
      tenantSlug,
      operation: row.Op ?? row.operation ?? "unknown",
      sourceCommitTime: row.commit_timestamp ?? row.timestamp,
      before: row.before ?? null,
      after: row.after ?? row,
      raw
    }));
    const digest = canonicalSha256Hex(normalizedRows);
    const outputKey = `tenants/${tenantSlug}/curated/cdc-normalized/${digest}.json`;
    const lineage = buildLineageEvent({
      tenantSlug,
      eventType: "normalized",
      inputs: [`s3://${bucket}/${key}`],
      outputs: [`s3://${outputBucket}/${outputKey}`],
      actor: "lambda:cdcNormalizer",
      metadata: { rowCount: normalizedRows.length }
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: outputBucket,
        Key: outputKey,
        ContentType: "application/json",
        Body: JSON.stringify({ normalizedRows, lineage }, null, 2)
      })
    );
    normalized += normalizedRows.length;
  }
  return { normalized };
}
