# Governed Invoke Validation

Status: AWS-RUNTIME-VALIDATION-CANDIDATE.

This runbook validates the governed invoke runtime path without production, enterprise, compliance, or AI-safety claims.

## Local Gate

Run the focused local slice:

```bash
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/unit/enforcement-runtime/vault tests/integration/test_governedInvokeLifecycle.test.ts
```

Run the full local gate:

```bash
npm run validate
```

## AWS Configuration Gate

CDK synthesizes `POST /tenants/{tenantSlug}/invoke` with Cognito authorization. The invoke Lambda defaults to:

- `GHOST_ARK_MODEL_MODE=bedrock`
- `GHOST_ARK_RECEIPT_SIGNER=kms`
- `GHOST_ARK_POLICY_REPOSITORY=dynamodb`
- `GHOST_ARK_VAULT=dynamodb`
- `GHOST_ARK_DECISION_RECEIPT_REPOSITORY=dynamodb`
- `GHOST_ARK_ALLOW_DEFAULT_POLICY=false`
- `GHOST_ARK_REJECT_CALLER_RETRIEVAL_CONTEXTS=true`
- `GHOST_ARK_REQUIRE_RETRIEVAL_PROVIDER=true`

CDK creates `ghost-ark-{stage}-decision-receipt-hmac-secret` in Secrets Manager and passes only `GHOST_ARK_RECEIPT_HMAC_SECRET_ARN` to the Lambda. The plaintext HMAC digest secret must not be placed in CDK environment variables.

Bedrock model IDs must be allowlisted:

```bash
npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
```

When the allowlist is present, Bedrock IAM uses foundation-model ARNs. Wildcard Bedrock IAM requires explicit `allowWildcardBedrockModels=true` and is a release blocker until reviewed.

## Tenant Policy Seed

Seed a minimal active policy before live invoke:

```bash
npm run seed:governed-policy -- --table ghost-ark-dev-tenant-policies --tenant acme-lab --stage dev
```

AWS mode fails closed if no active tenant policy exists unless `GHOST_ARK_ALLOW_DEFAULT_POLICY=true` is explicitly configured.

## Live Smoke

After deploy and Cognito login:

```bash
export API_URL="https://example.execute-api.us-east-1.amazonaws.com/dev"
export ID_TOKEN="<cognito-id-token>"
export TENANT="acme-lab"
export MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"

npm run smoke:governed-invoke -- --api "$API_URL" --token "$ID_TOKEN" --tenant "$TENANT" --model "$MODEL_ID" --expected-mode aws-validation
```

The smoke script sends:

- benign invoke, expected `completed` plus receipt,
- private-memory extraction attempt, expected `refused_pre_model` plus receipt,
- body tenant override attempt, expected rejection,
- cross-tenant retrieval contamination attempt, expected fail-closed rejection.

The script prints HTTP status, governed status, receipt emission status, receipt ID, and decision summary. It never prints the token.

## Expected Runtime Behavior

- Missing verified tenant or user identity fails closed.
- Path tenant and authenticated tenant mismatch fails closed.
- Client-declared tenant, user, or session authority is rejected recursively.
- AWS mode rejects caller-supplied retrieval contexts and requires a server-side provider when retrieval is enabled.
- Cross-tenant retrieval candidates are rejected before prompt construction.
- Untrusted instruction retrieval taint is represented as digest-only data.
- Model IDs outside `GHOST_ARK_BEDROCK_MODEL_ALLOWLIST` fail closed before Bedrock invocation.
- Optional Bedrock Guardrails are passed to Bedrock only when ID and version are configured; they do not replace Ghost Ark policy.
- Receipt emission failure after model output returns `failed_closed`.
- KAPPA memory is never persisted.
- SESSION memory requires expiry and reads filter expired records immediately.
- RESTRICTED memory requires explicit consent.

## Receipt Verification

Decision receipts can be verified with:

- local HMAC verifier for `LOCAL_HMAC_SHA256_DEV_ONLY`,
- KMS public-key verifier for `KMS_SIGN_RSASSA_PSS_SHA_256`.

Verification checks schema, receipt id, algorithm, key id, digest, canonical payload, and RSA-PSS signature validity. This verifies receipt integrity only.

## Operational Checks

Inspect CloudWatch alarms:

- `GovernedInvokeFailedClosedAlarm`
- `GovernedInvokeReceiptEmissionFailureAlarm`
- `GovernedInvokeKmsSigningFailureAlarm`
- `GovernedInvokeBedrockFailureAlarm`
- `InvokeGovernedLambdaErrorsAlarm`
- `InvokeGovernedLambdaDurationHighAlarm`

Metric namespace: `GhostArk/GovernedInvoke`. Metrics include stage, status, and normalized model ID only; they must not include tenant, user, prompt, output, or memory contents.

## Non-Claims

Decision receipts and successful smoke tests do not prove AI safety, legal compliance, clinical or emotional safety, semantic correctness, empirical truth, production readiness, or enterprise readiness.
