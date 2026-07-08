# Governed Invoke Live Smoke

This smoke validates the AWS governed invoke route as a validation candidate. It is not a production-readiness proof.

## 1. Synth Or Deploy

```bash
export STAGE=dev
export MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"

npx cdk synth -c stage="$STAGE" -c bedrockModelAllowlist="$MODEL_ID"
npx cdk deploy "GhostArk-${STAGE}-Api" -c stage="$STAGE" -c bedrockModelAllowlist="$MODEL_ID"
```

## 2. Confirm Secret

CDK creates:

```text
ghost-ark-dev-decision-receipt-hmac-secret
```

Confirm the invoke Lambda environment contains `GHOST_ARK_RECEIPT_HMAC_SECRET_ARN`, not the plaintext HMAC value.

## 3. Seed Tenant Policy

```bash
export TENANT="acme-lab"

npm run seed:governed-policy -- --table "ghost-ark-${STAGE}-tenant-policies" --tenant "$TENANT" --stage "$STAGE"
```

## 4. Create Or Login Cognito User

Use the `ReceiptUserPoolId` and `ReceiptUserPoolClientId` stack outputs. The user must have `custom:tenant_slug=$TENANT`.

Example outline:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USER_EMAIL" \
  --user-attributes Name=email,Value="$USER_EMAIL" Name=custom:tenant_slug,Value="$TENANT"

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USER_EMAIL" \
  --password "$USER_PASSWORD" \
  --permanent

aws cognito-idp initiate-auth \
  --client-id "$USER_POOL_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$USER_EMAIL",PASSWORD="$USER_PASSWORD"
```

Export the returned ID token:

```bash
export ID_TOKEN="<id-token>"
export API_URL="https://<api-id>.execute-api.<region>.amazonaws.com/${STAGE}"
export REPORT_PATH="docs/validation/governed-invoke-${STAGE}-$(date -u +%Y%m%dT%H%M%SZ).json"
```

## 5. Run Smoke

```bash
npm run smoke:governed-invoke -- \
  --api "$API_URL" \
  --token "$ID_TOKEN" \
  --tenant "$TENANT" \
  --model "$MODEL_ID" \
  --stage "$STAGE" \
  --expected-mode aws-validation \
  --json-report "$REPORT_PATH"
```

Expected cases:

- benign request: HTTP 200, `completed`, receipt emitted,
- private-memory extraction: HTTP 200, `refused_pre_model`, receipt emitted,
- body tenant override: HTTP 400,
- cross-tenant retrieval contamination: HTTP 403, `failed_closed`.

The report at `$REPORT_PATH` is sanitized validation evidence. It must include receipt IDs and decision phase summaries, and must not include the raw token, prompt, output, tenant label, user ID, session ID, or secrets.

## 6. Inspect Receipt

Use the receipt ID printed by the smoke script. Decision receipts are stored in `ghost-ark-${STAGE}-decision-receipts` with `tenantId` set to the tenant HMAC digest and `receiptId` as the sort key.

## 7. Verify Receipt

Use `KmsDecisionReceiptVerifier` from `packages/enforcement-runtime/src/receipts/kmsVerifier.ts` against the stored decision receipt. Verification checks schema, receipt id, algorithm, key id, digest, canonical payload, and RSA-PSS signature. It does not prove model correctness. The exact DynamoDB fetch and KMS verification command is in `docs/operations/runbooks/governed-invoke-validation.md`.

## 8. Check Alarms And Logs

Inspect CloudWatch:

- `GovernedInvokeFailedClosedAlarm`
- `GovernedInvokeReceiptEmissionFailureAlarm`
- `GovernedInvokeKmsSigningFailureAlarm`
- `GovernedInvokeBedrockFailureAlarm`
- `InvokeGovernedLambdaErrorsAlarm`
- `InvokeGovernedLambdaDurationHighAlarm`

Logs and EMF metrics must not contain raw prompt, output, memory, token, tenant, user, or session identifiers.

## 9. Release Gate Checklist

- [ ] `npm run validate` passes
- [ ] `cdk synth` passes
- [ ] tenant policy seeded
- [ ] HMAC digest secret configured
- [ ] Bedrock model allowlist configured
- [ ] live benign invoke returns completed plus receipt
- [ ] live refusal invoke returns refused_pre_model plus receipt
- [ ] sanitized smoke report written
- [ ] body tenant override rejected
- [ ] cross-tenant retrieval rejected
- [ ] decision receipt verifies
- [ ] CloudWatch alarm path configured
- [ ] IAM wildcard reviewed, removed, or justified as a release blocker
