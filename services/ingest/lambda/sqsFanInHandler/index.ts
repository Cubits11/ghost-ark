import { SQSEvent } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requiredEnv } from "../../../../packages/shared/src/config";
import { canonicalSha256Hex } from "../../../../packages/receipt-schema/src/hashCanonicalization";
import { assertTrustedTenantSource } from "../../../../packages/enforcement-runtime/src/tenancy/trustedTenantSource";

const s3 = new S3Client({});

export async function handler(event: SQSEvent): Promise<{ accepted: number; failed: number }> {
  const bucket = requiredEnv("CURATED_METADATA_BUCKET");
  let accepted = 0;
  let failed = 0;

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as { tenantSlug?: string; payload?: unknown };
      const tenantSlug = assertTrustedTenantSource({
        kind: "sqs",
        declaredTenantSlug: message.tenantSlug,
        sourceArn: record.eventSourceARN,
        sourceName: record.eventSourceARN?.split(":").at(-1)
      });
      const id = canonicalSha256Hex({ messageId: record.messageId, payload: message.payload });
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `tenants/${tenantSlug}/curated/fan-in/${id}.json`,
          ContentType: "application/json",
          Body: JSON.stringify({ acceptedAt: new Date().toISOString(), messageId: record.messageId, payload: message.payload })
        })
      );
      accepted += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ message: "failed to process SQS fan-in record", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  if (failed > 0) {
    throw new Error(`Failed to process ${failed} SQS records`);
  }
  return { accepted, failed };
}
