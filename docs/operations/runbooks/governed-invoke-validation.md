# Governed Invoke Validation

Status: VERIFIED-RUNTIME-SPINE-v0.1-CANDIDATE.

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
export STAGE="dev"
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

- benign invoke, expected `completed` plus receipt,
- private-memory extraction attempt, expected `refused_pre_model` plus receipt,
- body tenant override attempt, expected rejection,
- cross-tenant retrieval contamination attempt, expected fail-closed rejection.

The script prints HTTP status, governed status, receipt emission status, receipt ID, and decision summary. It never prints the token.

The JSON report is a sanitized artifact for review. It contains timestamp, stage, API host hash, tenant hash, model ID, case names, HTTP status, governed status, receipt emission state, receipt IDs, and decision-phase summaries. It must not contain the token, prompt text, model output text, raw tenant label, raw user ID, raw session ID, or secrets.

Quick report checks:

```bash
jq '.schemaVersion, .stage, .apiHostHash, .tenantHash, .modelId, .passed' "$REPORT_PATH"
jq '.cases[] | {name, httpStatus, governedStatus, receiptEmitted, receiptId, decisionPhases}' "$REPORT_PATH"

! grep -F "$ID_TOKEN" "$REPORT_PATH"
! grep -F "$TENANT" "$REPORT_PATH"
```

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
