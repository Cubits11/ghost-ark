resource "google_service_account" "ghost_ark_runtime" {
  account_id   = "ghostark-runtime"
  display_name = "Ghost-Ark Runtime Service Account"
  description  = "Service account used by Ghost-Ark service to write evidence and stream BigQuery rows"
}
