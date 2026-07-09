# Adversarial Runtime Evidence Index

Status: ADVERSARIAL-RUNTIME-EVIDENCE-v0.2-CANDIDATE.

This index records bounded runtime evidence only. It must not be used as a production-readiness, enterprise-readiness, legal/compliance, semantic-correctness, empirical-truth, or AI-safety claim.

## Local Test Commands

```bash
npm run lint
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/unit/enforcement-runtime/vault tests/unit/enforcement-runtime/bedrock tests/unit/tools tests/integration/test_governedInvokeLifecycle.test.ts
npm test
npm run build
npm run docs:check
npm run validate
npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
git diff --check
```

If Terraform files are touched:

```bash
terraform fmt -check -recursive infra/terraform
```

## What Each Test Family Proves

- `tests/unit/enforcement-runtime/retrieval`: retrieval sanitizer detects unlabelled malicious instructions, adds `untrusted_instruction`, emits `retrieval_untrusted_instruction`, and keeps tainted text out of prompt context.
- `tests/unit/enforcement-runtime/runtime`: governed invoke fails closed or blocks before model invocation for identity, policy, retrieval, receipt, model, and strict taint failures; strict retrieval blocks tainted provider output before prompt construction and receipt emission is still attempted.
- `tests/unit/enforcement-runtime/receipts`: receipt repositories return structured `CREATED` or `IDEMPOTENT_EXISTING` results, deterministic duplicate emission returns existing receipts, and digest collisions fail closed.
- `tests/unit/enforcement-runtime/vault`: memory reads exclude expired, tombstoned, wrong-session, and wrong-tier records in DynamoDB query filters and again at application level.
- `tests/unit/enforcement-runtime/bedrock`: explicit Bedrock adapter dispatch covers Anthropic, Titan, Cohere, Cohere Command R, and Mistral shapes; unsupported families fail unless generic JSON is explicitly opted in.
- `tests/unit/tools`: governed invoke smoke report generation omits token, prompt, output, raw tenant, raw user, raw session, and secret material while preserving receipt IDs and decision summaries.
- `tests/integration/test_governedInvokeLifecycle.test.ts`: local governed invoke path emits a receipt and includes only accepted retrieval context digests.

## Unproven Until Live AWS Smoke

- A deployed Lambda reaches Bedrock with the configured allowlisted model.
- KMS signs and verifies a persisted deployed decision receipt.
- CloudWatch logs and metrics stay sanitized in the deployed account.
- CloudWatch alarms exist and observe the expected governed invoke metrics.
- IAM Access Analyzer has no unresolved findings for the governed invoke path.
- A production OpenSearch or other SigV4 server-side retrieval provider exists. The current AWS strict mode is prepared to reject caller-supplied retrieval contexts and require a provider when retrieval is enabled.

## Path to LIVE-SUPERVISED-AWS-RUNTIME-v0.3-CANDIDATE

The only acceptable target claim for this lane is:

> Ghost-Ark has a live AWS-supervised governed invoke path that emits a KMS-verifiable decision receipt and produces sanitized validation evidence for bounded fail-closed runtime cases.

Required evidence:

- Sanitized supervised smoke report using `ghost.live_supervised_aws_runtime_report.v1`, stored under `evidence/live-aws-validation/${STAGE}/live-supervised-aws-runtime-${UTC_TIMESTAMP}.json`.
- KMS verification output recorded inside the supervised report, including verifier check names for schema, receipt id, algorithm, key id, digest, canonical payload, and signature.
- CloudWatch log redaction evidence showing recent governed invoke Lambda logs were inspected without storing raw log events, tokens, prompts, outputs, tenant labels, users, sessions, secrets, or retrieval text.
- CloudWatch metric/alarm evidence for the `GhostArk/GovernedInvoke` namespace and governed invoke alarms or alarm prefixes.
- IAM Access Analyzer evidence for the deployed account and region, with any finding touching governed invoke Lambda role, Bedrock permissions, KMS signing key, Secrets Manager HMAC secret, policy table, decision receipt table, or privacy vault table reviewed.
- OpenSearch/SigV4 provider status. If no production server-side retrieval provider is wired, the tainted retrieval provider case must remain `NOT_RUN_PROVIDER_ABSENT`.
- Explicit remaining blockers for any `NOT_RUN`, `BLOCKED`, or `FAIL` check.

Prepared artifact:

```text
evidence/live-aws-validation/samples/live-supervised-aws-runtime-report.sample.json
```

This report is bounded runtime validation evidence only. It does not prove AI safety, production readiness, enterprise readiness, legal compliance, semantic correctness, empirical truth, or model-output correctness.

## Sanitized Smoke Report Storage

Store sanitized governed invoke smoke reports under:

```text
evidence/live-aws-validation/${STAGE}/governed-invoke-${UTC_TIMESTAMP}.json
```

Reports must not include bearer tokens, raw prompts, raw outputs, raw tenant slugs, raw user IDs, raw session IDs, secrets, passwords, or raw retrieval text. A safe fixture is provided at `evidence/live-aws-validation/samples/governed-invoke-smoke-report.sample.json`.

Store supervised live AWS runtime reports under:

```text
evidence/live-aws-validation/${STAGE}/live-supervised-aws-runtime-${UTC_TIMESTAMP}.json
```

Supervised reports must not include bearer tokens, raw prompts, raw outputs, raw tenant slugs, raw user IDs, raw session IDs, secrets, passwords, raw retrieval text, raw HMAC secret IDs, or raw KMS key IDs. They may include hashes, receipt IDs, check names, statuses, sanitized operator commands, and explicit non-claims.

## Allowed Claim

Ghost-Ark has stronger adversarial runtime evidence for local fail-closed behavior and a clearer live AWS validation path, without production-readiness or AI-safety claims.

## Forbidden Claims

- Ghost-Ark is production ready.
- Ghost-Ark is enterprise ready.
- Ghost-Ark is AI safe.
- Ghost-Ark is legally or compliance certified.
- Do not claim Ghost-Ark proves semantic correctness.
- Do not claim Ghost-Ark proves empirical truth.
- Decision receipts prove model output correctness.
- Local tests replace live AWS validation.
