# AGENTS.md

## Mission

Ghost-Ark is an AWS-native reference implementation for bounded governance receipts, deterministic enforcement primitives, and externally checkable evidence around governed AI systems. The project exists to make narrow infrastructure claims auditable. It is not an AI safety certificate, compliance certificate, or truth oracle.

## Stack

- Primary: TypeScript, Node.js, npm workspaces, Vitest, AWS CDK, Terraform, JSON Schema.
- Secondary: Python only for AWS Glue jobs and AWS-gated test helpers already present in `services/transform/glue/jobs/` and `tests/aws/dev-account/`.
- Do not introduce Python project structure, `pyproject.toml`, `requirements.txt`, or pytest unless the touched area is already Python and the task explicitly requires it.

## Fast Commands

- Install: `npm ci`
- Typecheck/build: `npm run lint`
- Unit/integration tests: `npm test`
- Full local gate: `npm run validate`
- Focused Vitest: `npx vitest run <path>`
- Terraform check: `terraform fmt -check -recursive infra/terraform`
- Claim boundary check: `npm run claims:check`

Run focused tests for the files you touch. Run `npm run validate` before any commit that changes runtime, security-sensitive code, docs claims, schemas, CI, CDK, Terraform, or public examples.

## Claim Rules

Allowed claim shape: "Given receipt R, policy hash H, signature S, key manifest K, and checkpoint C, an external verifier can check the recorded binding under Ghost-Ark verifier rules."

Forbidden public claims:

- Ghost-Ark proves AI safety.
- Ghost-Ark guarantees safe model behavior.
- Ghost-Ark eliminates all risk.
- Ghost-Ark is fully trustless.
- Ghost-Ark certifies regulatory compliance by itself.
- Ghost-Ark proves truthfulness or semantic correctness of model outputs.

When adding README/docs/marketing copy, classify each claim using `docs/research/ASSURANCE_MATURITY_LADDER.md`. Separate implemented behavior, mock interfaces, schemas, documented designs, and future work.

## Safe Edit Zones

Agents may usually edit these with focused tests:

- `packages/research-frontier/src/**`
- `tests/unit/research-frontier/**`
- `schemas/research/**`
- `docs/research/**`
- `docs/compliance/**`
- `tools/research/**`
- `examples/sample-receipts/**`

Agents must edit these carefully and run broader tests:

- `packages/enforcement-runtime/src/**`
- `packages/receipt-schema/src/**`
- `packages/policy-compiler/src/**`
- `services/signing/kms/**`
- `services/ledger/dynamodb/**`
- `apps/api/src/**`
- `infra/cdk/**`
- `infra/terraform/**`
- `.github/workflows/**`

Do not edit without explicit human approval:

- Live AWS deployment workflows, prod environment settings, IAM trust policies, KMS key policy behavior, destructive cleanup scripts, secret names/paths, tenant namespace derivation, public cryptographic examples, and checked-in validation evidence under `evidence/live-aws-validation/**`.

## AWS And Secrets

- Do not run live AWS commands, CDK deploys, Terraform applies, Bedrock calls, KMS operations, or smoke tests that can spend money unless the user explicitly authorizes that exact action.
- Never print, commit, synthesize, or move secrets. Treat `.env`, AWS credentials, tokens, private keys, and MCP/agent config as sensitive.
- Prefer `npx cdk synth`, `terraform validate`, and local unit tests over live cloud operations.
- IAM, KMS, tenant isolation, signature verification, and receipt canonicalization are security-sensitive. Add negative tests for bypass, mismatch, replay, downgrade, and missing-context cases.

## Coding Style

- Follow existing TypeScript patterns. Keep modules small and deterministic.
- Use explicit types for public interfaces, schemas for external artifacts, and canonical serialization helpers where integrity matters.
- Fail closed on missing tenant, policy, key, receipt, attestation, or verifier context.
- Add comments only where they explain a non-obvious security or cryptographic boundary.

## Agent Operating Rules

- Read relevant files before editing. Do not infer repository structure from memory.
- Preserve user changes and unrelated dirty work.
- Do not add dependencies without a clear reason and tests.
- Do not rewrite architecture docs as marketing. Keep docs falsifiable and evidence-linked.
- Stop and ask when a task requires live AWS spend, production secret access, legal/compliance certification language, destructive data operations, or a new public cryptographic/security claim without evidence.

## Commit And PR Format

Commit messages use `<area>: <imperative summary>`, for example `ci: run forbidden claim scanner in validate`.

PRs must include:

- What changed
- Implemented vs documented vs mocked
- Tests run
- Security/claim-boundary impact
- Rollback plan
- Any human approvals required

Every rollback plan should name the files or commit to revert and explain whether data, AWS resources, or public artifacts are affected.
