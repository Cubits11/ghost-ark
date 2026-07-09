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
- Fast local gate: `npm run validate:fast`
- Claim boundary check: `npm run validate:claims`
- Legacy claim boundary alias: `npm run claims:check`
- Focused Vitest: `npx vitest run <path>`
- Terraform check: `terraform fmt -check -recursive infra/terraform`

Run focused tests for the files you touch. Run `npm run validate` before any commit that changes runtime, security-sensitive code, docs claims, schemas, CI, CDK, Terraform, or public examples.

## Forbidden Commands Without Human Approval

- `cdk deploy`
- `terraform apply`
- Mutating `aws ...` commands, including writes, deletes, KMS calls, Bedrock calls, and live smoke tests.
- `git push --force`
- `git reset --hard`
- `git clean -fd`
- Arbitrary `curl`/`bash` install scripts or remote shell installers.

## Claim Rules

Allowed claim shape: "Given receipt R, policy hash H, signature S, key manifest K, and checkpoint C, an external verifier can check the recorded binding under Ghost-Ark verifier rules."

Do not publicly claim:

- Do not claim that Ghost-Ark proves AI safety.
- Do not claim that Ghost-Ark guarantees safe model behavior, model safety, or alignment.
- Do not claim that Ghost-Ark eliminates all risk.
- Do not claim that Ghost-Ark is fully trustless or unbreakable.
- Do not claim that Ghost-Ark certifies regulatory compliance, SOC2, HIPAA, FedRAMP, ISO 42001, or NIST status.
- Do not claim that Ghost-Ark proves truthfulness or semantic correctness of model outputs.
- Do not claim that Ghost-Ark executes live zk proofs, live Nitro Enclaves, or formal proofs without checked-in implementation and evidence.

When adding README/docs/marketing copy, classify each claim using `docs/research/ASSURANCE_MATURITY_LADDER.md`. Separate implemented behavior, mock interfaces, schemas, documented designs, and future work.

## Mock Vs Real Boundary

- Mock verifiers must be named `Mock*`.
- Mock data must say it is non-cryptographic, test-only, or simulation-only.
- Never claim mock verifier output is a real zk, Nitro, or formal proof.

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
- Never read `.env`, `~/.aws/credentials`, `~/.ssh/*`, browser credential stores, or OS credential managers.
- Never print environment variables, tokens, private keys, AWS credentials, or MCP/agent config.
- Never commit, synthesize, copy, or move secrets.
- Prefer `npx cdk synth`, `terraform validate`, and local unit tests over live cloud operations.
- IAM, KMS, tenant isolation, signature verification, and receipt canonicalization are security-sensitive. Add negative tests for bypass, mismatch, replay, downgrade, and missing-context cases.

## Workspace Boundaries

- Do not write outside the repository workspace.
- Do not follow or write through symlinks that resolve outside the repository root.

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
- Before a final commit, run the focused test first, run `npm run validate`, then inspect `git diff` and `git status -s`.
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
