# @ghost-ark/google-cloud

Google Cloud evidence lakehouse, Cloud Storage receipt persistence, and BigQuery transparency log indexing for Ghost-Ark.

## Usage

```typescript
import { StorageClient, BigQueryClient, ReceiptUploader } from '@ghost-ark/google-cloud';

const uploader = new ReceiptUploader({
  bucketName: 'ghost-ark-evidence-dev',
  datasetId: 'ghost_ark_ledger',
  tableId: 'receipts'
});
```

## Security & Claim Boundary

This module provides deterministic cloud persistence and querying for Ghost-Ark receipt artifacts. All verifiers follow Ghost-Ark claim boundaries (`AGENTS.md`).
