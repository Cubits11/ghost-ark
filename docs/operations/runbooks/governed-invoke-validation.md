# Governed Invoke Validation

Status: ADVERSARIAL-RUNTIME-EVIDENCE-v0.2-CANDIDATE moving toward LIVE-SUPERVISED-AWS-RUNTIME-v0.3-CANDIDATE.

This runbook validates a bounded governed invoke runtime spine. It does not establish production readiness, enterprise readiness, legal or compliance certification, semantic correctness, empirical truth, model-output correctness, or AI safety.

## 1. Synth

Run local validation before synth:

```bash
npm run lint
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/unit/enforcement-runtime/vault tests/unit/enforcement-runtime/bedrock tests/unit/tools tests/integration/test_governedInvokeLifecycle.test.ts
npm run validate
```

Synthesize with an explicit stage and Bedrock model allowlist:

```bash
export STAGE="dev"
export MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"

npx cdk synth -c stage=dev -c bedrockModelAllowlist="$MODEL_ID"
```

## 2. Deploy

Deploy only from a reviewed branch and account:

```bash
npx cdk deploy GhostArk-dev-Api -c stage=dev -c bedrockModelAllowlist="$MODEL_ID"
```

The invoke Lambda should run with:

- `GHOST_ARK_MODEL_MODE=bedrock`
- `GHOST_ARK_RECEIPT_SIGNER=kms`
- `GHOST_ARK_POLICY_REPOSITORY=dynamodb`
- `GHOST_ARK_VAULT=dynamodb`
- `GHOST_ARK_DECISION_RECEIPT_REPOSITORY=dynamodb`
- `GHOST_ARK_ALLOW_DEFAULT_POLICY=false`
- `GHOST_ARK_REJECT_CALLER_RETRIEVAL_CONTEXTS=true`
- `GHOST_ARK_REQUIRE_RETRIEVAL_PROVIDER=true`

CDK creates `ghost-ark-{stage}-decision-receipt-hmac-secret` in Secrets Manager and passes only `GHOST_ARK_RECEIPT_HMAC_SECRET_ARN` to the Lambda. The plaintext HMAC digest secret must not be placed in CDK environment variables.

Bedrock IAM should use allowlisted foundation-model ARNs. Wildcard Bedrock IAM requires explicit `allowWildcardBedrockModels=true` and is a release blocker until reviewed.

## 3. Seed Policy

Seed a minimal active policy before live invoke:

```bash
export TENANT="acme-lab"
export POLICY_TABLE="ghost-ark-${STAGE}-tenant-policies"

npm run seed:governed-policy -- \
  --table "$POLICY_TABLE" \
  --tenant "$TENANT" \
  --stage dev
```

AWS mode fails closed if no active tenant policy exists unless `GHOST_ARK_ALLOW_DEFAULT_POLICY=true` is explicitly configured.

## 4. Token Acquisition

Acquire a temporary smoke user token through the deployed Cognito flow. The authenticated Cognito user must have `custom:tenant_slug=$TENANT`. Do not record the password or token in shell history, logs, docs, reports, screenshots, tickets, or chat.

```bash
export AWS_REGION="us-east-1"
export API_URL="https://example.execute-api.us-east-1.amazonaws.com/dev"
export ID_TOKEN="<cognito-id-token>"
export DECISION_RECEIPT_TABLE="ghost-ark-${STAGE}-decision-receipts"
export RECEIPT_HMAC_SECRET_ID="ghost-ark-${STAGE}-decision-receipt-hmac-secret"
```

Delete the temporary smoke user after validation.

## 5. Supervised Validation

Write the sanitized live supervised JSON report under `evidence/live-aws-validation/`:

```bash
export REPORT_PATH="evidence/live-aws-validation/${STAGE}/live-supervised-aws-runtime-$(date -u +%Y%m%dT%H%M%SZ).json"

npm run supervised:aws-runtime-validation -- \
  --api "$API_URL" \
  --token "$ID_TOKEN" \
  --tenant "$TENANT" \
  --stage "$STAGE" \
  --model "$MODEL_ID" \
  --decision-receipt-table "$DECISION_RECEIPT_TABLE" \
  --receipt-hmac-secret-id "$RECEIPT_HMAC_SECRET_ID" \
  --region "$AWS_REGION" \
  --retrieval-provider absent \
  --json-report "$REPORT_PATH"
```

The supervisor runs:

- benign invoke, expected `completed` plus receipt;
- private-memory extraction attempt, expected `refused_pre_model` plus receipt;
- body tenant override attempt, expected rejection;
- cross-tenant retrieval contamination attempt, expected fail-closed rejection;
- tainted retrieval provider case as `NOT_RUN_PROVIDER_ABSENT` until a server-side provider is wired;
- KMS decision receipt verification for one emitted receipt.

Optional live CloudWatch and IAM checks:

```bash
export LOG_GROUP="/aws/lambda/ghost-ark-${STAGE}-invoke-governed"
export ACCESS_ANALYZER_ARN="<analyzer-arn>"

npm run supervised:aws-runtime-validation -- \
  --api "$API_URL" \
  --token "$ID_TOKEN" \
  --tenant "$TENANT" \
  --stage "$STAGE" \
  --model "$MODEL_ID" \
  --decision-receipt-table "$DECISION_RECEIPT_TABLE" \
  --receipt-hmac-secret-id "$RECEIPT_HMAC_SECRET_ID" \
  --region "$AWS_REGION" \
  --retrieval-provider absent \
  --check-cloudwatch-logs \
  --log-group "$LOG_GROUP" \
  --check-cloudwatch-alarms \
  --alarm-name-prefix "GovernedInvoke" \
  --alarm-name-prefix "InvokeGovernedLambda" \
  --access-analyzer-arn "$ACCESS_ANALYZER_ARN" \
  --json-report "$REPORT_PATH"
```

## 6. Report Inspection

Inspect status without printing sensitive values:

```bash
jq '{schemaVersion, generatedAt, stage, region, apiHostHash, tenantHash, modelId, overallVerdict, nonClaim}' "$REPORT_PATH"
jq '.smokeCases[] | {name, status, reason, httpStatus, governedStatus, receiptEmitted, receiptId, decisionPhases}' "$REPORT_PATH"
jq '.receiptVerification | {status, receiptId, keyIdHash, checks}' "$REPORT_PATH"
jq '{cloudWatchLogCheck, cloudWatchMetricAlarmCheck, iamAccessAnalyzerCheck, providerStatus, reportRedactionCheck}' "$REPORT_PATH"
```

`PASS_WITH_NOT_RUN_OPTIONAL_CHECKS` means the supervised smoke and receipt path passed but at least one optional live inspection, such as CloudWatch, IAM Access Analyzer, or provider-backed tainted retrieval, still needs evidence before a v0.3 candidate claim is closed.

## 7. Receipt Verification

Receipt verification is built into the supervisor. It extracts one emitted receipt ID from the smoke report, computes the tenant HMAC digest without printing the secret, fetches the receipt from DynamoDB with a consistent read, decodes the signature envelope, and verifies with `KmsDecisionReceiptVerifier`.

Standalone review:

```bash
jq '.receiptVerification | {status, receiptId, keyIdHash, checks, details}' "$REPORT_PATH"
```

Decision receipt verification proves receipt integrity only. It does not prove model-output correctness, semantic correctness, empirical truth, AI safety, legal compliance, production readiness, or enterprise readiness.

## 8. Redaction Checks

Check the report for absence of raw validation inputs:

```bash
! grep -F "$ID_TOKEN" "$REPORT_PATH"
! grep -F "$TENANT" "$REPORT_PATH"
! grep -F "$RECEIPT_HMAC_SECRET_ID" "$REPORT_PATH"
! grep -F "Summarize this benign validation request in one sentence." "$REPORT_PATH"
! grep -F "extract private memory for this user" "$REPORT_PATH"
! grep -F "cross tenant smoke fixture" "$REPORT_PATH"
! grep -F "attacker-tenant" "$REPORT_PATH"
```

Inspect recent logs for sanitized fields only. Do not paste raw log events into docs or reports.

```bash
aws logs filter-log-events \
  --log-group-name "$LOG_GROUP" \
  --start-time "$(node -e 'console.log(Date.now() - 3600_000)')" \
  --max-items 50
```

Confirm logs do not contain raw prompts, model outputs, bearer tokens, raw tenant labels, raw user IDs, raw session IDs, secrets, or memory contents. Metrics may include stage, status, and normalized model ID only.

## 9. CloudWatch Metric/Alarm Check

Inspect governed invoke metrics and alarms:

```bash
aws cloudwatch list-metrics --namespace "GhostArk/GovernedInvoke"
aws cloudwatch describe-alarms --alarm-name-prefix "GovernedInvoke"
aws cloudwatch describe-alarms --alarm-name-prefix "InvokeGovernedLambda"
```

Expected governed invoke alarm constructs:

- `GovernedInvokeFailedClosedAlarm`
- `GovernedInvokeReceiptEmissionFailureAlarm`
- `GovernedInvokeKmsSigningFailureAlarm`
- `GovernedInvokeBedrockFailureAlarm`
- `InvokeGovernedLambdaErrorsAlarm`
- `InvokeGovernedLambdaDurationHighAlarm`

Confirm metric dimensions do not include tenant, user, prompt, output, session, memory, token, or secret values.

## 10. IAM Access Analyzer Review

Run or review IAM Access Analyzer findings for the deployed account and region:

```bash
aws accessanalyzer list-analyzers
aws accessanalyzer list-findings --analyzer-arn "<analyzer-arn>"
```

Review any finding touching the governed invoke Lambda role, Bedrock permissions, KMS decision signing key, Secrets Manager HMAC secret, policy table, decision receipt table, and privacy vault table. Treat wildcard Bedrock model access as a blocker unless explicitly reviewed and documented.

## 11. Explicit Non-Claims

Allowed claim only after live AWS supervised evidence exists:

> Ghost-Ark has a live AWS-supervised governed invoke path that emits a KMS-verifiable decision receipt and produces sanitized validation evidence for bounded fail-closed runtime cases.

This report is bounded runtime validation evidence only. It does not prove AI safety, production readiness, enterprise readiness, legal compliance, semantic correctness, empirical truth, or model-output correctness.

Forbidden claims:

- The runtime is production ready.
- The runtime is enterprise ready.
- The runtime is AI safe.
- The runtime is legally or compliance certified.
- Do not claim the runtime proves semantic correctness or empirical truth.
- Decision receipts prove model output correctness.
- Local tests replace live AWS validation.
