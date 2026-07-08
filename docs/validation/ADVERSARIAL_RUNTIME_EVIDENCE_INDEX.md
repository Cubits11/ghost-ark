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

## Sanitized Smoke Report Storage

Store sanitized governed invoke smoke reports under:

```text
docs/validation/governed-invoke-${STAGE}-${UTC_TIMESTAMP}.json
```

Reports must not include bearer tokens, raw prompts, raw outputs, raw tenant slugs, raw user IDs, raw session IDs, secrets, passwords, or raw retrieval text. A safe fixture is provided at `docs/validation/governed-invoke-smoke-report.sample.json`.

## Allowed Claim

Ghost-Ark has stronger adversarial runtime evidence for local fail-closed behavior and a clearer live AWS validation path, without production-readiness or AI-safety claims.

## Forbidden Claims

- Ghost-Ark is production ready.
- Ghost-Ark is enterprise ready.
- Ghost-Ark is AI safe.
- Ghost-Ark is legally or compliance certified.
- Ghost-Ark proves semantic correctness.
- Ghost-Ark proves empirical truth.
- Decision receipts prove model output correctness.
- Local tests replace live AWS validation.
