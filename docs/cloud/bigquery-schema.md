# Ghost-Ark BigQuery Table Schema Specification

Dataset: `ghost_ark_ledger`  
Table: `receipts`

| Field Name | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| `receipt_id` | STRING | REQUIRED | Canonical receipt identifier (`rct_sha256`) |
| `tenant_slug` | STRING | REQUIRED | Tenant namespace slug |
| `issued_at` | TIMESTAMP | REQUIRED | Receipt issuance ISO timestamp |
| `subject_kind` | STRING | REQUIRED | Kind of subject entity |
| `subject_id` | STRING | REQUIRED | Subject identifier |
| `digest_sha256` | STRING | REQUIRED | SHA-256 payload digest |
| `signature_key_id` | STRING | REQUIRED | KMS Key ID used for signature |
| `status` | STRING | REQUIRED | Status (`issued`, `superseded`, `revoked`, `disputed`) |
| `gcs_uri` | STRING | REQUIRED | GCS storage path |
| `ingested_at` | TIMESTAMP | REQUIRED | Ingestion timestamp |
