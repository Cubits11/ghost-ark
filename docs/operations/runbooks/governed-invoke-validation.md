# Governed Invoke Validation

Status: ADVERSARIAL-RUNTIME-EVIDENCE-v0.2-CANDIDATE.

This runbook validates the bounded governed invoke runtime spine. It does not establish production readiness, enterprise readiness, legal or compliance certification, semantic correctness, empirical truth, or AI safety.

## 1. Deploy/Synth Command

Run local validation before synth:

```bash
npm run lint
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/unit/enforcement-runtime/vault tests/unit/enforcement-runtime/bedrock tests/unit/tools tests/integration/test_governedInvokeLifecycle.test.ts
npm run validate
```

Synthesize with an explicit Bedrock model allowlist:

```bash
npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
```

Deploy only from a reviewed branch and account:

```bash
npx cdk deploy -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
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

## 2. Policy Seed Command

Seed a minimal active policy before live invoke:

```bash
export STAGE="dev"
export TENANT="acme-lab"
export POLICY_TABLE="ghost-ark-${STAGE}-tenant-policies"

npm run seed:governed-policy -- \
  --table "$POLICY_TABLE" \
  --tenant "$TENANT" \
  --stage "$STAGE"
```

AWS mode fails closed if no active tenant policy exists unless `GHOST_ARK_ALLOW_DEFAULT_POLICY=true` is explicitly configured.

## 3. Cognito User/Token Acquisition Placeholder

Acquire a temporary smoke user token through the deployed Cognito flow. Do not record the password or token in shell history, logs, docs, reports, screenshots, tickets, or chat.

```bash
export API_URL="https://example.execute-api.us-east-1.amazonaws.com/dev"
export ID_TOKEN="<cognito-id-token>"
export TENANT="acme-lab"
export MODEL_ID="anthropic.claude-3-5-sonnet-20240620-v1:0"
export STAGE="dev"
```

Delete the temporary smoke user after validation.

## 4. Smoke Run With `--json-report`

Write the sanitized JSON report under `docs/validation/`:

```bash
export REPORT_PATH="docs/validation/governed-invoke-${STAGE}-$(date -u +%Y%m%dT%H%M%SZ).json"

npm run smoke:governed-invoke -- \
  --api "$API_URL" \
  --token "$ID_TOKEN" \
  --tenant "$TENANT" \
  --model "$MODEL_ID" \
  --stage "$STAGE" \
  --expected-mode aws-validation \
  --json-report "$REPORT_PATH"
```

The smoke script sends:

- benign invoke, expected `completed` plus receipt;
- private-memory extraction attempt, expected `refused_pre_model` plus receipt;
- body tenant override attempt, expected rejection;
- cross-tenant retrieval contamination attempt, expected fail-closed rejection.

The script prints HTTP status, governed status, receipt emission status, receipt ID, and decision summary. It never prints the token.

The JSON report is a sanitized artifact for review. It contains timestamp, stage, API host hash, tenant hash, model ID, case names, HTTP status, governed status, receipt emission state, receipt IDs, and decision-phase summaries. It must not contain the token, prompt text, model output text, raw tenant label, raw user ID, raw session ID, secrets, or raw retrieval content.

Quick report checks:

```bash
jq '.schemaVersion, .stage, .apiHostHash, .tenantHash, .modelId, .passed' "$REPORT_PATH"
jq '.cases[] | {name, httpStatus, governedStatus, receiptEmitted, receiptId, decisionPhases}' "$REPORT_PATH"

! grep -F "$ID_TOKEN" "$REPORT_PATH"
! grep -F "$TENANT" "$REPORT_PATH"
! grep -E 'prompt|output|token|secret|password|session|userId|tenantSlug' "$REPORT_PATH"
```

## 5. KMS Decision Receipt Verification

Decision receipts can be verified with:

- local HMAC verifier for `LOCAL_HMAC_SHA256_DEV_ONLY`;
- KMS public-key verifier for `KMS_SIGN_RSASSA_PSS_SHA_256`.

Verification checks schema, receipt id, algorithm, key id, digest, canonical payload, and RSA-PSS signature validity. This verifies receipt integrity only.

After smoke, verify at least one emitted KMS decision receipt. The decision receipt table key uses the tenant HMAC digest, so compute it without printing the secret:

```bash
export DECISION_RECEIPT_TABLE="ghost-ark-${STAGE}-decision-receipts"
export RECEIPT_HMAC_SECRET_ID="ghost-ark-${STAGE}-decision-receipt-hmac-secret"
export RECEIPT_ID="$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.env.REPORT_PATH,"utf8")); const c=r.cases.find((x)=>x.receiptEmitted && x.receiptId); if (!c) process.exit(1); console.log(c.receiptId);')"

node -r ts-node/register <<'NODE'
const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { KmsDecisionReceiptVerifier } = require("./packages/enforcement-runtime/src/receipts/kmsVerifier");
const { verifyDecisionReceipt } = require("./packages/enforcement-runtime/src/receipts/verifier");

(async () => {
  const secretResponse = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: process.env.RECEIPT_HMAC_SECRET_ID })
  );
  const hmacSecret = secretResponse.SecretString ?? Buffer.from(secretResponse.SecretBinary ?? "").toString("utf8");
  const tenantId = `hmac-sha256:${crypto.createHmac("sha256", hmacSecret).update(process.env.TENANT).digest("hex")}`;
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const response = await dynamodb.send(
    new GetCommand({
      TableName: process.env.DECISION_RECEIPT_TABLE,
      Key: { tenantId, receiptId: process.env.RECEIPT_ID },
      ConsistentRead: true
    })
  );
  const receipt = response.Item && response.Item.receipt;
  if (!receipt) {
    throw new Error("Decision receipt not found");
  }
  const envelope = JSON.parse(Buffer.from(receipt.receipt_signature, "base64url").toString("utf8"));
  const result = await verifyDecisionReceipt(receipt, new KmsDecisionReceiptVerifier({ keyId: envelope.keyId }));
  console.log(JSON.stringify({ receiptId: receipt.receipt_id, verdict: result.verdict, checks: result.checks }, null, 2));
  if (!result.verdict) {
    process.exitCode = 1;
  }
})();
NODE
```

## 6. CloudWatch Log Redaction Check

Inspect recent logs for sanitized fields only. Do not paste raw log events into docs or reports.

```bash
export LOG_GROUP="/aws/lambda/ghost-ark-${STAGE}-invoke-governed"

aws logs filter-log-events \
  --log-group-name "$LOG_GROUP" \
  --start-time "$(node -e 'console.log(Date.now() - 3600_000)')" \
  --filter-pattern '"governed invoke"' \
  --max-items 20
```

Confirm logs do not contain raw prompts, model outputs, bearer tokens, raw tenant labels, raw user IDs, raw session IDs, secrets, or memory contents. Metrics may include stage, status, and normalized model ID only.

## 7. CloudWatch Alarm/Metric Check

Inspect governed invoke alarms:

- `GovernedInvokeFailedClosedAlarm`
- `GovernedInvokeReceiptEmissionFailureAlarm`
- `GovernedInvokeKmsSigningFailureAlarm`
- `GovernedInvokeBedrockFailureAlarm`
- `InvokeGovernedLambdaErrorsAlarm`
- `InvokeGovernedLambdaDurationHighAlarm`

Metric namespace: `GhostArk/GovernedInvoke`.

```bash
aws cloudwatch list-metrics --namespace "GhostArk/GovernedInvoke"
aws cloudwatch describe-alarms --alarm-name-prefix "GovernedInvoke"
aws cloudwatch describe-alarms --alarm-name-prefix "InvokeGovernedLambda"
```

Confirm metric dimensions do not include tenant, user, prompt, output, session, memory, token, or secret values.

## 8. IAM Access Analyzer Review

Run or review IAM Access Analyzer findings for the deployed account and region:

```bash
aws accessanalyzer list-analyzers
aws accessanalyzer list-findings --analyzer-arn "<analyzer-arn>"
```

Review any finding touching the governed invoke Lambda role, Bedrock permissions, KMS decision signing key, Secrets Manager HMAC secret, policy table, decision receipt table, and privacy vault table. Treat wildcard Bedrock model access as a blocker unless explicitly reviewed and documented.

## 9. Explicit Non-Claims

Allowed claim after local tests and prepared AWS validation path:

> Ghost-Ark has stronger adversarial runtime evidence for local fail-closed behavior and a clearer live AWS validation path, without production-readiness or AI-safety claims.

Forbidden claims:

- The runtime is production ready.
- The runtime is enterprise ready.
- The runtime is AI safe.
- The runtime is legally or compliance certified.
- The runtime proves semantic correctness or empirical truth.
- Decision receipts prove model output correctness.
