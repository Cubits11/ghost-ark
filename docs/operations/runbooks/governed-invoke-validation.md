# Governed Invoke Validation

This runbook validates the governed invoke runtime path without expanding its claims.

## Local Tests

Run the focused local slice:

```bash
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/unit/enforcement-runtime/vault tests/integration/test_governedInvokeLifecycle.test.ts
```

Run the full local gate:

```bash
npm run validate
```

## CDK Route

CDK synthesizes `POST /tenants/{tenantSlug}/invoke` with Cognito authorization. The invoke Lambda defaults to AWS-backed modes:

- `GHOST_ARK_MODEL_MODE=bedrock`
- `GHOST_ARK_RECEIPT_SIGNER=kms`
- `GHOST_ARK_POLICY_REPOSITORY=dynamodb`
- `GHOST_ARK_VAULT=dynamodb`
- `GHOST_ARK_DECISION_RECEIPT_REPOSITORY=dynamodb`

The Lambda also needs `GHOST_ARK_RECEIPT_HMAC_SECRET` for HMAC digests of low-entropy tenant, user, and session identifiers. If it is missing in AWS-backed mode, the handler fails closed.

## Expected Runtime Behavior

- Missing verified tenant or user identity fails closed.
- Path tenant and authenticated tenant mismatch fails closed.
- Client-declared tenant, user, or session authority is rejected.
- Cross-tenant retrieval candidates are rejected before prompt construction.
- Untrusted instruction retrieval taint is represented as digest-only data.
- Pre-model refusal prevents model invocation.
- Receipt emission failure after model output returns `failed_closed`.
- KAPPA memory is never persisted.
- SESSION memory requires expiry and reads filter expired records immediately.
- RESTRICTED memory requires explicit consent.

## Non-Claims

Decision receipts do not prove model correctness, legal compliance, AI safety, clinical or emotional safety, empirical truth, or absence of hidden context. KMS signatures prove only that the canonical decision receipt envelope was signed by the configured key.

## Live AWS Checks Still Required

- Cognito-authenticated call to `/tenants/{tenantSlug}/invoke`.
- Tenant policy load from DynamoDB.
- Bedrock invocation for the selected model ID.
- KMS decision receipt signing.
- Decision receipt table write.
- DynamoDB privacy vault write and read-time expiry behavior.
