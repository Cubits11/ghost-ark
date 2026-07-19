output "evidence_bucket_name" {
  value = google_storage_bucket.evidence_bucket.name
}

output "bigquery_dataset_id" {
  value = google_bigquery_dataset.ghost_ark_ledger.dataset_id
}

output "service_account_email" {
  value = google_service_account.ghost_ark_runtime.email
}
