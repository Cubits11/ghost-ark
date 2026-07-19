resource "google_storage_bucket" "evidence_bucket" {
  name                     = "ghost-ark-evidence-${var.environment}"
  location                 = var.region
  force_destroy            = false
  public_access_prevention = "enforced"

  versioning {
    enabled = true
  }

  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "receipt_bucket" {
  name                     = "ghost-ark-receipts-${var.environment}"
  location                 = var.region
  force_destroy            = false
  public_access_prevention = "enforced"

  versioning {
    enabled = true
  }

  uniform_bucket_level_access = true
}
