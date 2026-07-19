resource "google_logging_project_sink" "receipt_audit_sink" {
  name                   = "ghost-ark-receipt-audit-sink"
  destination            = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.ghost_ark_ledger.dataset_id}"
  filter                 = "resource.type=\"gcs_bucket\" AND protoPayload.methodName=\"storage.objects.create\""
  unique_writer_identity = true
}
