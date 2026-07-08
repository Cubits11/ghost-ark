import { PutObjectCommand, PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";
import { ScheduledEvent } from "aws-lambda";
import { requiredEnv, optionalEnv } from "../../../../packages/shared/src/config";
import { createSignedEpochCheckpoint } from "../../../../packages/enforcement-runtime/src/receipts/checkpoint";
import { DynamoDbReceiptCheckpointRepository } from "../../../../packages/enforcement-runtime/src/receipts/checkpointRepository";
import { KmsDecisionReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { DynamoDbDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/repository";

const s3 = new S3Client({});

export interface PublishReceiptCheckpointResult {
  epochId: string;
  merkleRoot: string;
  leafCount: number;
  published: {
    bucket: string;
    key: string;
    objectLockMode?: string;
    retainUntil?: string;
  };
}

function defaultEpochId(createdAt: string): string {
  return `epoch-${createdAt.slice(0, 13)}`;
}

function retentionDate(createdAt: string, days: number): Date {
  const start = new Date(createdAt);
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function handler(_event: ScheduledEvent): Promise<PublishReceiptCheckpointResult> {
  const createdAt = new Date().toISOString();
  const epochId = process.env.GHOST_ARK_RECEIPT_CHECKPOINT_EPOCH_ID ?? defaultEpochId(createdAt);
  const publishBucket = requiredEnv("GHOST_ARK_CHECKPOINT_PUBLISH_BUCKET");
  const publishPrefix = optionalEnv("GHOST_ARK_CHECKPOINT_PUBLISH_PREFIX", "receipt-checkpoints").replace(/^\/+|\/+$/gu, "");
  const objectLockMode = optionalEnv("GHOST_ARK_CHECKPOINT_OBJECT_LOCK_MODE", "GOVERNANCE").toUpperCase();
  const retentionDays = Number.parseInt(optionalEnv("GHOST_ARK_CHECKPOINT_OBJECT_LOCK_DAYS", "365"), 10);
  const retainUntil = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDate(createdAt, retentionDays) : undefined;

  const checkpoint = await createSignedEpochCheckpoint({
    epochId,
    createdAt,
    receiptRepository: new DynamoDbDecisionReceiptRepository({
      tableName: requiredEnv("GHOST_ARK_DECISION_RECEIPT_TABLE")
    }),
    checkpointRepository: new DynamoDbReceiptCheckpointRepository({
      tableName: requiredEnv("GHOST_ARK_RECEIPT_CHECKPOINT_TABLE")
    }),
    signer: new KmsDecisionReceiptSigner({
      keyId: requiredEnv("GHOST_ARK_CHECKPOINT_SIGNING_KEY_ID")
    })
  });

  const key = `${publishPrefix}/${checkpoint.epochId}.json`;
  const body = JSON.stringify(
    {
      checkpoint,
      publishedAt: createdAt,
      transparency: {
        bucket: publishBucket,
        key,
        objectLockMode,
        retainUntil: retainUntil?.toISOString(),
        nonClaim:
          "A published checkpoint makes split-view equivocation challengeable for recorded chain heads; it does not prove receipt contents, AI safety, or AWS account integrity."
      }
    },
    null,
    2
  );
  const putInput: PutObjectCommandInput = {
    Bucket: publishBucket,
    Key: key,
    ContentType: "application/json",
    CacheControl: "public, max-age=300",
    Body: body
  };
  if (retainUntil) {
    putInput.ObjectLockMode = objectLockMode === "COMPLIANCE" ? "COMPLIANCE" : "GOVERNANCE";
    putInput.ObjectLockRetainUntilDate = retainUntil;
  }
  await s3.send(new PutObjectCommand(putInput));

  return {
    epochId: checkpoint.epochId,
    merkleRoot: checkpoint.merkleRoot,
    leafCount: checkpoint.leafCount,
    published: {
      bucket: publishBucket,
      key,
      objectLockMode: retainUntil ? putInput.ObjectLockMode : undefined,
      retainUntil: retainUntil?.toISOString()
    }
  };
}
