# Sandbox Validation

Use this runbook after changing Terraform, CDK, or tenant-isolation behavior in a dev AWS account.

## Terraform

1. From `infra/terraform/accounts/dev`, run `terraform init` if the working directory is new.
2. Run `terraform plan`.
3. Confirm the tenant sandbox policy JSON contains `${aws:PrincipalTag/slug}` in S3 resource ARNs, S3 prefix conditions, and DynamoDB leading-key conditions.
4. Confirm the plan enables `aws_s3_bucket_versioning` for raw, curated, exports, and Athena results buckets.

## CDK

1. Run `npm run lint` and `npm test`.
2. Run `npx cdk synth`.
3. Deploy the dev stacks from `infra/cdk` after reviewing the synthesized changes.

## Alarm Notification

1. Subscribe a verified endpoint to `ghost-ark-<stage>-observatory-alerts`.
2. After deployment, set `ghost-ark-<stage>-LambdaErrorAlarm` or `ghost-ark-<stage>-ReceiptGapAlarm` to `ALARM` in CloudWatch.
3. Confirm the subscribed endpoint receives the SNS notification.

## Receipt API Authorizer

1. Create or federate a Cognito user with `custom:tenant_slug` set to the tenant slug.
2. Call `POST /receipts` and `GET /tenants/{tenantSlug}/receipts/{receiptId}` with the Cognito JWT.
3. Confirm Lambda logs show authorizer claims on `requestContext.authorizer` and that the handler resolves the expected tenant slug.

## End To End

1. Set `RUN_AWS_TESTS=true` and the required `GHOST_ARK_*` environment variables.
2. Run `pytest tests/aws/...`.
3. Upload a sample record from `examples/sample-evidence/`, run the receipt Step Function, and query the issued receipt through the API.
4. Attempt S3 access to another tenant prefix with the tenant principal tag. The request should be denied.
