output "raw_bucket" {
  value = aws_s3_bucket.raw.bucket
}

output "curated_bucket" {
  value = aws_s3_bucket.curated.bucket
}

output "export_bucket" {
  value = aws_s3_bucket.exports.bucket
}

output "athena_results_bucket" {
  value = aws_s3_bucket.athena_results.bucket
}

output "receipt_signing_key_arn" {
  value = aws_kms_key.receipt_signing.arn
}

output "tenant_service_role_arn" {
  value = aws_iam_role.tenant_service_role.arn
}

output "tenant_sandbox_policy_arn" {
  value = module.tenant_sandbox.policy_arn
}
