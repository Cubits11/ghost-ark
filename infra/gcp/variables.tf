variable "project_id" {
  type        = string
  description = "GCP Project ID"
  default     = "ghost-ark-dev"
}

variable "region" {
  type        = string
  description = "GCP Region"
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Deployment environment"
  default     = "dev"
}
