# AWS Runtime Validation Gate

Target verdict: VERIFIED-RUNTIME-SPINE-v0.1-CANDIDATE.

This gate is not a production, enterprise, compliance, or AI-safety gate. It proves only that the AWS-backed governed invoke path can be deployed, exercised, inspected, and attacked.

## Checklist

- [ ] `npm run validate` passes
- [ ] `cdk synth` passes
- [ ] tenant policy seeded
- [ ] HMAC digest secret configured
- [ ] Bedrock model allowlist configured
- [ ] live benign invoke returns completed plus receipt
- [ ] live refusal invoke returns refused_pre_model plus receipt
- [ ] body tenant override rejected
- [ ] cross-tenant retrieval rejected
- [ ] decision receipt verifies
- [ ] CloudWatch alarm path configured
- [ ] IAM wildcard reviewed, removed, or justified as a release blocker

## Required Commands

```bash
npm run validate
npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
npm run seed:governed-policy -- --table ghost-ark-dev-tenant-policies --tenant acme-lab --stage dev
npm run smoke:governed-invoke -- --api "$API_URL" --token "$ID_TOKEN" --tenant acme-lab --model anthropic.claude-3-5-sonnet-20240620-v1:0 --stage dev --json-report evidence/live-aws-validation/dev/governed-invoke-dev.json
```

## Pass Conditions

- The invoke route derives tenant/user identity from Cognito or authorizer context only.
- The path tenant matches the authenticated tenant.
- Nested client-declared tenant, user, or session identifiers are rejected.
- AWS policy mode uses a seeded active tenant policy or an explicit default-policy override.
- Decision receipts contain digests, not raw prompts, outputs, or memory contents.
- AWS signing uses KMS and receipt verification succeeds with the KMS public key.
- The smoke report artifact contains receipt IDs and decision phase summaries without raw token, prompt, output, tenant, user, session, or secret values.
- Bedrock model ID is allowlisted before invocation.
- Bedrock IAM is scoped to allowlisted model ARNs unless an explicit wildcard release blocker is accepted.
- Retrieval uses a server-side provider when enabled in AWS mode; caller-supplied contexts are rejected.
- Failed-closed, receipt failure, KMS signing failure, Bedrock failure, and Lambda alarms exist.

## Non-Claims

Passing this gate does not prove AI safety, legal compliance, clinical or emotional safety, semantic correctness, empirical truth, enterprise readiness, or production readiness.
