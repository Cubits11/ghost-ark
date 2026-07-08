import { S3Event } from "aws-lambda";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requiredEnv } from "../../../../packages/shared/src/config";
import { evidenceObjectId } from "../../../../packages/receipt-schema/src/hashCanonicalization";
import { buildLineageEvent } from "../../../../packages/lineage-model/src/events";
import { assertTrustedTenantSource } from "../../../../packages/enforcement-runtime/src/tenancy/trustedTenantSource";

const s3 = new S3Client({});

function tenantFromKey(key: string): string {
  const decoded = decodeURIComponent(key.replace(/\+/gu, " "));
  const match = decoded.match(/^tenants\/([^/]+)\/raw\//u);
  if (!match) {
    throw new Error(`S3 key is outside tenant raw namespace: ${decoded}`);
  }
  return match[1];
}

export async function handler(event: S3Event): Promise<{ processed: number }> {
  const metadataBucket = requiredEnv("CURATED_METADATA_BUCKET");
  let processed = 0;
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/gu, " "));
    const tenantSlug = assertTrustedTenantSource({
      kind: "s3",
      declaredTenantSlug: tenantFromKey(key),
      sourceArn: record.s3.bucket.arn,
      sourceName: bucket,
      key
    });
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const objectUri = `s3://${bucket}/${key}`;
    const evidence = {
      tenantSlug,
      source: { kind: "s3-drop", system: "s3", sourceId: record.eventName },
      objectUri,
      contentSha256: head.Metadata?.["sha256"] ?? record.s3.object.eTag?.replace(/"/gu, "") ?? "unknown",
      contentType: head.ContentType ?? "application/octet-stream",
      sizeBytes: head.ContentLength ?? record.s3.object.size,
      observedAt: record.eventTime,
      metadata: {
        sequencer: record.s3.object.sequencer,
        versionId: record.s3.object.versionId
      }
    };
    const evidenceId = evidenceObjectId(evidence);
    const metadataKey = `tenants/${tenantSlug}/curated/metadata/evidence/${evidenceId}.json`;
    const lineage = buildLineageEvent({
      tenantSlug,
      eventType: "ingested",
      inputs: [objectUri],
      outputs: [evidenceId],
      actor: "lambda:s3DropHandler",
      metadata: { bucket, key }
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: metadataBucket,
        Key: metadataKey,
        ContentType: "application/json",
        Body: JSON.stringify({ evidenceObjectId: evidenceId, ...evidence, lineage }, null, 2)
      })
    );
    processed += 1;
  }
  return { processed };
}
