import { ReceiptPublisher, StorageClient, BigQueryClient } from "../../../../packages/google-cloud/src";
import { ReceiptRecord } from "../../../../packages/receipt-schema/src/receipt";

export async function handleUploadReceipt(record: ReceiptRecord, tenantSlug: string, bucketName: string) {
  const storage = new StorageClient(true);
  const bq = new BigQueryClient(true);
  const publisher = new ReceiptPublisher(storage, bq);

  return publisher.publishReceipt({
    record,
    tenantSlug,
    bucketName
  });
}
