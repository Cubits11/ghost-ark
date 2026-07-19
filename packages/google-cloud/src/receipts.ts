import { StorageClient } from "./storage";
import { BigQueryClient } from "./bigquery";
import { BigQueryReceiptRow, CloudStorageManifest } from "./schema";
import { ReceiptRecord } from "../../receipt-schema/src/receipt";
import { canonicalSha256Hex } from "../../receipt-schema/src/hashCanonicalization";

export interface ReceiptPublishInput {
  record: ReceiptRecord;
  tenantSlug: string;
  bucketName: string;
}

export interface ReceiptPublishResult {
  receiptId: string;
  gcsUri: string;
  manifest: CloudStorageManifest;
  bigQueryRow: BigQueryReceiptRow;
}

export class ReceiptPublisher {
  constructor(
    private readonly storageClient: StorageClient,
    private readonly bigQueryClient: BigQueryClient
  ) {}

  async publishReceipt(input: ReceiptPublishInput): Promise<ReceiptPublishResult> {
    const receiptId = input.record.payload.receiptId;
    const jsonStr = JSON.stringify(input.record, null, 2);
    const objectPath = `tenants/${input.tenantSlug}/receipts/${receiptId}.json`;

    const manifest = await this.storageClient.upload({
      bucket: input.bucketName,
      objectPath,
      data: jsonStr,
      contentType: "application/json",
      tenantSlug: input.tenantSlug,
      metadata: {
        receiptId,
        digestSha256: input.record.signature.digestSha256
      }
    });

    const gcsUri = `gs://${input.bucketName}/${objectPath}`;
    const ingestedAt = new Date().toISOString();

    const bigQueryRow: BigQueryReceiptRow = {
      receipt_id: receiptId,
      tenant_slug: input.tenantSlug,
      issued_at: input.record.payload.issuedAt,
      subject_kind: input.record.payload.subject.kind,
      subject_id: input.record.payload.subject.id,
      subject_uri: input.record.payload.subject.uri,
      digest_sha256: input.record.signature.digestSha256,
      signature_key_id: input.record.signature.keyId,
      signature_base64: input.record.signature.signatureBase64,
      status: input.record.status,
      gcs_uri: gcsUri,
      ingested_at: ingestedAt,
      raw_json: jsonStr
    };

    await this.bigQueryClient.insertReceiptRows([bigQueryRow]);

    return {
      receiptId,
      gcsUri,
      manifest,
      bigQueryRow
    };
  }
}
