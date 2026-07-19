resource "google_bigquery_dataset" "ghost_ark_ledger" {
  dataset_id                 = "ghost_ark_ledger"
  friendly_name              = "Ghost-Ark Transparency Ledger"
  description                = "Immutable receipt index and transparency audit log dataset"
  location                   = var.region
  delete_contents_on_destroy = false
}

resource "google_bigquery_table" "receipts" {
  dataset_id          = google_bigquery_dataset.ghost_ark_ledger.dataset_id
  table_id            = "receipts"
  deletion_protection = true

  time_partitioning {
    type  = "DAY"
    field = "issued_at"
  }

  schema = <<EOF
[
  {
    "name": "receipt_id",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Canonical receipt ID (rct_sha256)"
  },
  {
    "name": "tenant_slug",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Tenant namespace slug"
  },
  {
    "name": "issued_at",
    "type": "TIMESTAMP",
    "mode": "REQUIRED",
    "description": "Receipt issuance timestamp"
  },
  {
    "name": "subject_kind",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Subject entity classification"
  },
  {
    "name": "subject_id",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Subject ID"
  },
  {
    "name": "digest_sha256",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "SHA-256 payload digest"
  },
  {
    "name": "signature_key_id",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Signer key identifier"
  },
  {
    "name": "status",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Receipt status (issued, superseded, revoked, disputed)"
  },
  {
    "name": "gcs_uri",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "GCS storage object URI"
  },
  {
    "name": "ingested_at",
    "type": "TIMESTAMP",
    "mode": "REQUIRED",
    "description": "Ingestion timestamp"
  }
]
EOF
}
