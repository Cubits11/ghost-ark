variable "project" { type = string }
variable "stage" { type = string }
variable "account_id" { type = string }
variable "aws_region" { type = string }
variable "allowed_regions" { type = list(string) }
variable "tenant_slug" { type = string }
variable "raw_bucket" { type = string }
variable "curated_bucket" { type = string }
variable "export_bucket" { type = string }
variable "athena_results_bucket" { type = string }
variable "tenant_service_role_arn" { type = string }
variable "permissions_boundary_arn" {
  type    = string
  default = null
}

locals {
  name_prefix = "${var.project}-${var.stage}"
}

data "aws_iam_policy_document" "tenant_sandbox" {
  statement {
    sid       = "DenyOutsideApprovedRegions"
    effect    = "Deny"
    actions   = ["*"]
    resources = ["*"]

    condition {
      test     = "StringNotEquals"
      variable = "aws:RequestedRegion"
      values   = var.allowed_regions
    }
  }

  statement {
    sid    = "DenyIdentityAndBoundaryEscalation"
    effect = "Deny"
    actions = [
      "account:*",
      "organizations:*",
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:AttachUserPolicy",
      "iam:AttachGroupPolicy",
      "iam:AttachRolePolicy",
      "iam:PutUserPolicy",
      "iam:PutGroupPolicy",
      "iam:PutRolePolicy",
      "iam:CreatePolicyVersion",
      "iam:SetDefaultPolicyVersion",
      "iam:DeletePermissionsBoundary"
    ]
    resources = ["*"]
  }

  statement {
    sid       = "RequirePrincipalSlug"
    effect    = "Deny"
    actions   = ["*"]
    resources = ["*"]

    condition {
      test     = "Null"
      variable = "aws:PrincipalTag/slug"
      values   = ["true"]
    }
  }

  statement {
    sid    = "AllowTenantScopedS3Objects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload"
    ]
    resources = [
      "arn:aws:s3:::${var.raw_bucket}/tenants/&{aws:PrincipalTag/slug}/*",
      "arn:aws:s3:::${var.curated_bucket}/tenants/&{aws:PrincipalTag/slug}/*",
      "arn:aws:s3:::${var.export_bucket}/tenants/&{aws:PrincipalTag/slug}/*",
      "arn:aws:s3:::${var.athena_results_bucket}/tenants/&{aws:PrincipalTag/slug}/*"
    ]
  }

  statement {
    sid       = "AllowTenantScopedBucketListing"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [
      "arn:aws:s3:::${var.raw_bucket}",
      "arn:aws:s3:::${var.curated_bucket}",
      "arn:aws:s3:::${var.export_bucket}",
      "arn:aws:s3:::${var.athena_results_bucket}"
    ]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["tenants/&{aws:PrincipalTag/slug}", "tenants/&{aws:PrincipalTag/slug}/*"]
    }
  }

  statement {
    sid    = "AllowTenantLedgerRows"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${local.name_prefix}-receipts",
      "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${local.name_prefix}-claims",
      "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${local.name_prefix}-lineage"
    ]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["&{aws:PrincipalTag/slug}"]
    }
  }

  statement {
    sid    = "AllowGlueAthenaLakeFormationRead"
    effect = "Allow"
    actions = [
      "athena:StartQueryExecution",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
      "glue:GetDatabase",
      "glue:GetTable",
      "glue:GetPartitions",
      "glue:CreatePartition",
      "glue:BatchCreatePartition",
      "lakeformation:GetDataAccess"
    ]
    resources = ["*"]
  }

  statement {
    sid       = "AllowServiceBoundPassRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [var.tenant_service_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["glue.amazonaws.com", "lambda.amazonaws.com", "states.amazonaws.com"]
    }
  }

  dynamic "statement" {
    for_each = var.permissions_boundary_arn == null ? [] : [var.permissions_boundary_arn]
    content {
      sid       = "DenyRoleCreationWithoutBoundary"
      effect    = "Deny"
      actions   = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"]
      resources = ["*"]

      condition {
        test     = "StringNotEquals"
        variable = "iam:PermissionsBoundary"
        values   = [statement.value]
      }
    }
  }
}

resource "aws_iam_policy" "tenant_sandbox" {
  name        = "${local.name_prefix}-${var.tenant_slug}-tenant-sandbox"
  description = "Ghost Ark tenant sandbox with principal-tag scoping and regional deny controls."
  policy      = data.aws_iam_policy_document.tenant_sandbox.json
}

output "policy_arn" {
  value = aws_iam_policy.tenant_sandbox.arn
}

output "policy_json" {
  value = data.aws_iam_policy_document.tenant_sandbox.json
}
