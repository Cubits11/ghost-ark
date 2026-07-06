variable "project" {
  type        = string
  description = "Project name prefix."
  default     = "ghost-ark"
}

variable "stage" {
  type        = string
  description = "Deployment stage."
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "Primary AWS region."
  default     = "us-east-1"
}

variable "allowed_regions" {
  type        = list(string)
  description = "Regions allowed by tenant sandbox policy."
  default     = ["us-east-1"]
}

variable "bootstrap_tenant_slug" {
  type        = string
  description = "Initial tenant slug used to compile a first sandbox policy."
  default     = "example-tenant"
}

variable "permissions_boundary_arn" {
  type        = string
  description = "Optional IAM permissions boundary required for tenant-created roles."
  default     = null
}
