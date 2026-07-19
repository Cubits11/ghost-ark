export interface GoogleCloudConfig {
  projectId: string;
  evidenceBucket: string;
  receiptBucket: string;
  datasetId: string;
  receiptTableId: string;
  checkpointTableId: string;
  keyFilename?: string;
  maxRetries?: number;
}

export function loadGoogleCloudConfig(env: Record<string, string | undefined> = process.env): GoogleCloudConfig {
  return {
    projectId: env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || "ghost-ark-dev",
    evidenceBucket: env.GCS_EVIDENCE_BUCKET || "ghost-ark-evidence-dev",
    receiptBucket: env.GCS_RECEIPT_BUCKET || "ghost-ark-receipts-dev",
    datasetId: env.BIGQUERY_DATASET || "ghost_ark_ledger",
    receiptTableId: env.BIGQUERY_RECEIPT_TABLE || "receipts",
    checkpointTableId: env.BIGQUERY_CHECKPOINT_TABLE || "checkpoints",
    keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS,
    maxRetries: env.GCP_MAX_RETRIES ? parseInt(env.GCP_MAX_RETRIES, 10) : 3
  };
}
