# Ghost-Ark Receipt Lifecycle on Google Cloud

1. **Generation**: The application constructs a `ReceiptPayload` containing governance context and evidence references.
2. **Signing**: Key pair signs the payload digest to create a `ReceiptRecord`.
3. **Storage Upload**: The JSON `ReceiptRecord` is stored in Cloud Storage at `tenants/{tenant}/receipts/{receiptId}.json`.
4. **BigQuery Ingestion**: The receipt metadata and digest are inserted into the BigQuery `receipts` table.
5. **Checkpointing**: Epoch Merkle root is calculated across issued receipts and published as a `ReceiptCheckpoint`.
