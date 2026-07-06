terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project = var.project
      Stage   = var.stage
      Owner   = "ghost-ark"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix   = "${var.project}-${var.stage}"
  account_id    = data.aws_caller_identity.current.account_id
  bucket_suffix = "${local.account_id}-${var.aws_region}"
}

resource "aws_s3_bucket" "raw" {
  bucket        = "${local.name_prefix}-raw-${local.bucket_suffix}"
  force_destroy = false
}

resource "aws_s3_bucket" "curated" {
  bucket        = "${local.name_prefix}-curated-${local.bucket_suffix}"
  force_destroy = false
}

resource "aws_s3_bucket" "exports" {
  bucket        = "${local.name_prefix}-exports-${local.bucket_suffix}"
  force_destroy = false
}

resource "aws_s3_bucket" "athena_results" {
  bucket        = "${local.name_prefix}-athena-results-${local.bucket_suffix}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "all" {
  for_each = {
    raw            = aws_s3_bucket.raw.id
    curated        = aws_s3_bucket.curated.id
    exports        = aws_s3_bucket.exports.id
    athena_results = aws_s3_bucket.athena_results.id
  }

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "all" {
  for_each = {
    raw            = aws_s3_bucket.raw.id
    curated        = aws_s3_bucket.curated.id
    exports        = aws_s3_bucket.exports.id
    athena_results = aws_s3_bucket.athena_results.id
  }

  bucket = each.value

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_kms_key" "receipt_signing" {
  description              = "Ghost Ark ${var.stage} asymmetric receipt signing key"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_3072"
  deletion_window_in_days  = 30
}

resource "aws_kms_alias" "receipt_signing" {
  name          = "alias/${local.name_prefix}-receipt-signing"
  target_key_id = aws_kms_key.receipt_signing.key_id
}

resource "aws_iam_role" "tenant_service_role" {
  name = "${local.name_prefix}-tenant-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = [
            "glue.amazonaws.com",
            "lambda.amazonaws.com",
            "states.amazonaws.com"
          ]
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_group" "tenant_operators" {
  name = "${local.name_prefix}-tenant-operators"
}

module "tenant_sandbox" {
  source = "../modules/iam-tenant-sandbox"

  project                  = var.project
  stage                    = var.stage
  account_id               = local.account_id
  aws_region               = var.aws_region
  allowed_regions          = var.allowed_regions
  tenant_slug              = var.bootstrap_tenant_slug
  raw_bucket               = aws_s3_bucket.raw.bucket
  curated_bucket           = aws_s3_bucket.curated.bucket
  export_bucket            = aws_s3_bucket.exports.bucket
  athena_results_bucket    = aws_s3_bucket.athena_results.bucket
  tenant_service_role_arn  = aws_iam_role.tenant_service_role.arn
  permissions_boundary_arn = var.permissions_boundary_arn
}

resource "aws_iam_group_policy_attachment" "tenant_sandbox" {
  group      = aws_iam_group.tenant_operators.name
  policy_arn = module.tenant_sandbox.policy_arn
}
