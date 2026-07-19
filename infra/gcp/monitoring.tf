resource "google_monitoring_alert_policy" "evidence_upload_failures" {
  display_name = "Ghost-Ark Evidence Upload Failure Alert"
  combiner     = "OR"
  conditions {
    display_name = "High GCS upload error rate"
    condition_threshold {
      filter          = "resource.type = \"gcs_bucket\" AND metric.type = \"storage.googleapis.com/api/request_count\" AND metric.label.response_code != \"200\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
    }
  }
}
