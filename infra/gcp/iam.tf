resource "google_project_iam_member" "bq_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.ghost_ark_runtime.email}"
}

resource "google_storage_bucket_iam_member" "evidence_writer" {
  bucket = google_storage_bucket.evidence_bucket.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ghost_ark_runtime.email}"
}
