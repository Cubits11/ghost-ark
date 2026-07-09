# CODEX_TASKS.md

This backlog is for local-first Codex execution in Ghost-Ark. It assumes TypeScript, npm, Vitest, AWS CDK, Terraform, JSON Schema, and markdown docs. Python tasks are allowed only for existing AWS Glue jobs or AWS-gated Python tests.

## Mandatory Task Contract

Every executable Codex task must name:

- Branch.
- Files to edit.
- Files forbidden to edit.
- Implementation goal.
- Tests to run.
- Commit message.
- Rollback plan.
- Claim/non-claim boundary.
- Human approval required.

## Current Next 10 Task Titles

1. test(scanner): add negative tests for forbidden claim scanner
2. chore(npm): add focused validation scripts for research and claim checks
3. docs(agents): tighten symlink, secrets, and live AWS boundaries
4. docs(pr): require mock-vs-cryptographic proof boundary declaration
5. docs(security): add SECURITY.md with experimental unaudited status
6. proofs: add tenant isolation TLA+ model stub
7. transparency: add deterministic Merkle checkpoint primitive
8. attestation: model Nitro PCR-bound KMS release conditions
9. zk: add execution receipt interface and mock verifier
10. docs(readme): add current-status and non-claims table

## Defaults For Every Task

- Branch format: `codex/<area>-<short-slug>`.
- Commit format: `<area>: <imperative summary>`.
- Forbidden edits unless explicitly listed: `package-lock.json`, `evidence/live-aws-validation/**`, prod deploy workflows, live AWS account values, secrets, checked-in keys, destructive cleanup behavior, unrelated modules.
- Standard PR body:

```md
## What Changed
- <task-specific summary>

## Implementation Status
- Implemented: <yes/no>
- Documented-only: <yes/no>
- Mock/research-only: <yes/no>

## Claim Boundary
- Allowed claim:
- Non-claim:

## Tests
- <commands run>

## Rollback Plan
- Revert this commit and restore listed files; no live AWS resources are touched unless the task says otherwise.
```

- Standard definition of done: listed files changed only as needed; focused tests pass; `npm run claims:check` passes for claim/doc tasks; README/docs separate implemented, mocked, and aspirational work; no live AWS spend without approval.

## Immediate Safety And Agent Readiness

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 1 | Add root agent operating contract | `codex/agent-root-agents-md` | `AGENTS.md` | Add compact stack, safety, claim, AWS, and test rules. | `npm run claims:check` | `docs: add root agent operating contract` | Low | No |
| 2 | Add executable Codex backlog | `codex/agent-codex-tasks` | `CODEX_TASKS.md` | Add grouped tasks with branches, tests, rollback, and DoD. | `npm run claims:check` | `docs: add codex execution backlog` | Low | No |
| 3 | Add PR claim-boundary template | `codex/agent-pr-template` | `.github/PULL_REQUEST_TEMPLATE.md` | Force claim status, tests, rollback, AWS spend, and secrets review. | `npm run docs:check` | `docs: add claim-boundary pr template` | Low | No |
| 4 | Wire forbidden-claim scanner into validate | `codex/ci-claims-check-validate` | `package.json`, `tools/research/check-forbidden-claims.mjs` | Add `claims:check`; include it in `validate`; keep policy-doc exceptions explicit. | `npm run validate` | `ci: run forbidden claim scanner in validate` | Medium | No |
| 5 | Add agent-safe issue labels doc | `codex/agent-labels-doc` | `docs/operations/AGENT_LABELS.md` | Define `agent-safe`, `security-sensitive`, `aws-manual`, `research-only`, `claim-boundary`. | `npm run docs:check && npm run claims:check` | `docs: define agent-safe issue labels` | Low | No |
| 6 | Add no-live-AWS agent checklist | `codex/agent-no-live-aws-checklist` | `docs/operations/runbooks/agent-local-first.md` | Document local-first command ladder and human approval gates. | `npm run docs:check && npm run claims:check` | `docs: add local-first agent runbook` | Low | No |

## Research Control Plane

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 7 | Add frontier manifest fixture | `codex/research-frontier-fixture` | `examples/research/frontier-manifest.local.json`, `tests/unit/research-frontier/frontierClaims.test.ts` | Add valid and invalid manifest fixtures for claim/evidence status. | `npx vitest run tests/unit/research-frontier/frontierClaims.test.ts` | `research: add frontier manifest fixtures` | Low | No |
| 8 | Add evidence hash verifier for frontier manifests | `codex/research-frontier-hash-verifier` | `packages/research-frontier/src/frontierClaims.ts`, tests | Verify evidence paths and SHA-256 values from local files. | `npx vitest run tests/unit/research-frontier/frontierClaims.test.ts` | `research: verify frontier evidence hashes` | Medium | No |
| 9 | Add maturity ladder field to frontier claims | `codex/research-claim-maturity-field` | `schemas/research/frontier-manifest.schema.json`, `packages/research-frontier/src/frontierClaims.ts`, tests | Add L0-L8 claim maturity with validation rules. | `npx vitest run tests/unit/research-frontier/frontierClaims.test.ts` | `research: add claim maturity validation` | Medium | No |
| 10 | Add frontier manifest CLI skeleton | `codex/research-frontier-cli` | `tools/scripts/verifyFrontierManifest.ts`, `tools/scripts/package.json`, `package.json` | Add local CLI for manifest semantic validation. | `npm run build && npx ts-node tools/scripts/verifyFrontierManifest.ts --help` | `research: add frontier manifest verifier cli` | Medium | No |
| 11 | Add research non-claim golden tests | `codex/research-nonclaim-goldens` | `tests/unit/research-frontier/frontierClaims.test.ts`, `docs/research/**` | Assert disallowed public claim fragments are rejected in manifests. | `npx vitest run tests/unit/research-frontier/frontierClaims.test.ts && npm run claims:check` | `research: add non-claim golden tests` | Low | No |

## Transparency And Merkle

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 12 | Add Merkle inclusion proof generation | `codex/transparency-inclusion-proof` | `packages/research-frontier/src/merkle.ts`, tests | Generate sibling path with leaf index and root. | `npx vitest run tests/unit/research-frontier/witnessCheckpoint.test.ts` | `transparency: add merkle inclusion proofs` | Medium | No |
| 13 | Add Merkle inclusion proof verification | `codex/transparency-verify-inclusion` | `packages/research-frontier/src/merkle.ts`, tests | Verify root from payload/leaf and proof path; reject malformed hashes. | `npx vitest run tests/unit/research-frontier/witnessCheckpoint.test.ts` | `transparency: verify merkle inclusion proofs` | Medium | No |
| 14 | Add checkpoint consistency proof placeholder schema | `codex/transparency-consistency-schema` | `schemas/research/witness-checkpoint.schema.json`, `packages/research-frontier/src/witnessCheckpoint.ts`, tests | Add documented consistency-proof field marked not implemented. | `npx vitest run tests/unit/research-frontier/witnessCheckpoint.test.ts` | `transparency: schema consistency proof placeholder` | Low | No |
| 15 | Add witness key manifest schema | `codex/transparency-witness-key-schema` | `schemas/research/witness-key-manifest.schema.json`, `tests/unit/research-frontier/witnessCheckpoint.test.ts` | Define witness id, public key, algorithm, effective dates. | `npm test -- tests/unit/research-frontier/witnessCheckpoint.test.ts` | `transparency: add witness key manifest schema` | Medium | No |
| 16 | Add local checkpoint bundle example | `codex/transparency-checkpoint-example` | `examples/research/checkpoint-bundle/**`, docs, tests | Create sample payload, checkpoint, witness metadata, and verifier fixture. | `npm test -- tests/unit/research-frontier/witnessCheckpoint.test.ts` | `transparency: add local checkpoint bundle` | Low | No |

## Nitro Attestation

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 17 | Add Nitro PCR field explanations | `codex/attestation-pcr-docs` | `docs/architecture/runtime-attestation.md`, `docs/research/THREAT_MODEL_FRONTIER.md` | Explain PCR0/PCR1/PCR2/PCR8 as measurement bindings, not broad safety proof. | `npm run docs:check && npm run claims:check` | `attestation: document nitro pcr boundaries` | Low | No |
| 18 | Add Nitro manifest golden fixture validation | `codex/attestation-manifest-goldens` | `attestations/nitro/*.json`, `tests/unit/research-frontier/nitroManifest.test.ts` | Add pass/fail manifests for required PCRs and image digest. | `npx vitest run tests/unit/research-frontier/nitroManifest.test.ts` | `attestation: add nitro manifest goldens` | Low | No |
| 19 | Add KMS condition action coverage test | `codex/attestation-kms-actions` | `packages/research-frontier/src/nitroKmsPolicy.ts`, tests | Ensure Decrypt/DataKey/GenerateRandom action options keep attestation conditions. | `npx vitest run tests/unit/research-frontier/nitroKmsPolicy.test.ts` | `attestation: test kms action condition coverage` | Medium | No |
| 20 | Add attestation doc parser stub | `codex/attestation-doc-parser-stub` | `packages/research-frontier/src/nitroAttestationDocument.ts`, tests | Add explicit unimplemented COSE/CBOR parser interface that fails closed. | `npx vitest run tests/unit/research-frontier/nitroManifest.test.ts` | `attestation: add fail-closed attestation document parser stub` | Medium | No |
| 21 | Add reproducible EIF build plan doc | `codex/attestation-eif-build-plan` | `docs/research/NITRO_REPRODUCIBLE_BUILD_PLAN.md` | Document local-only build metadata requirements and non-claims. | `npm run docs:check && npm run claims:check` | `attestation: document reproducible eif build plan` | Low | No |

## Formal Methods

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 22 | Add TLA+ run instructions | `codex/proofs-tla-runbook` | `proofs/tla/README.md` | Explain current stub, TLC install, expected limitations, and non-claims. | `npm run claims:check` | `proofs: add tla run instructions` | Low | No |
| 23 | Add policy invariant registry | `codex/proofs-invariant-registry` | `docs/research/FORMAL_METHODS_NOTES.md`, `schemas/research/frontier-manifest.schema.json` | List invariants with evidence status and mapped tests. | `npm run docs:check && npm run claims:check` | `proofs: add policy invariant registry` | Low | No |
| 24 | Add deny-precedence property tests | `codex/proofs-deny-precedence-tests` | `packages/policy-compiler/src/invariants.ts`, `tests/unit/enforcement-runtime/policy/**` | Add edge cases proving deny beats allow in supported compiler path. | `npx vitest run tests/unit/enforcement-runtime/policy` | `proofs: test deny precedence invariants` | Medium | No |
| 25 | Add tenant isolation counterexample fixture | `codex/proofs-tenant-counterexample-fixture` | `packages/policy-compiler/src/formal/**`, tests | Add intentionally bad policy fixture and expected counterexample. | `npx vitest run tests/unit/enforcement-runtime/policy` | `proofs: add tenant isolation counterexample fixture` | Medium | No |
| 26 | Add formal-to-runtime traceability table | `codex/proofs-runtime-traceability` | `docs/research/FORMAL_METHODS_NOTES.md` | Map each formal invariant to TypeScript test, runtime module, and missing proof. | `npm run claims:check` | `proofs: map formal invariants to runtime tests` | Low | No |

## zk Receipt Interface

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 27 | Add zk public journal canonicalization | `codex/zk-journal-canonicalization` | `packages/research-frontier/src/zkReceipt.ts`, tests | Define deterministic public journal hash and reject missing commitments. | `npx vitest run tests/unit/research-frontier/zkReceipt.test.ts` | `zk: canonicalize public journals` | Medium | No |
| 28 | Add RISC Zero verifier adapter placeholder | `codex/zk-risc0-adapter-placeholder` | `packages/research-frontier/src/zkReceipt.ts`, tests, docs | Add fail-closed adapter interface; no crypto claim. | `npx vitest run tests/unit/research-frontier/zkReceipt.test.ts && npm run claims:check` | `zk: add risc0 verifier adapter placeholder` | Low | No |
| 29 | Add SP1 verifier adapter placeholder | `codex/zk-sp1-adapter-placeholder` | `packages/research-frontier/src/zkReceipt.ts`, tests, docs | Add fail-closed SP1 adapter interface; no crypto claim. | `npx vitest run tests/unit/research-frontier/zkReceipt.test.ts && npm run claims:check` | `zk: add sp1 verifier adapter placeholder` | Low | No |
| 30 | Add zk receipt example bundle | `codex/zk-example-bundle` | `examples/research/zk-receipt/**`, tests | Add mock receipt bundle with explicit mock status and negative fixture. | `npx vitest run tests/unit/research-frontier/zkReceipt.test.ts` | `zk: add mock receipt example bundle` | Low | No |
| 31 | Add zk non-claim docs | `codex/zk-nonclaim-docs` | `docs/research/ZK_RECEIPT_BOUNDARIES.md` | State what zk receipts can and cannot prove for Ghost-Ark. | `npm run docs:check && npm run claims:check` | `zk: document receipt proof boundaries` | Low | No |

## External Verifier CLI

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 32 | Add receipt bundle verifier command | `codex/verifier-bundle-cli` | `tools/scripts/verifyReceiptBundle.ts`, `package.json`, tests | Verify receipt, key manifest, checkpoint, and tenant binding from local files. | `npm run build && npm test -- tests/unit/receipt-schema` | `verifier: add local receipt bundle cli` | Medium | No |
| 33 | Add verifier negative fixtures | `codex/verifier-negative-fixtures` | `examples/sample-receipts/**`, `tests/unit/receipt-schema/**` | Add wrong tenant, wrong key, altered payload, stale checkpoint fixtures. | `npm test -- tests/unit/receipt-schema` | `verifier: add negative receipt fixtures` | Medium | No |
| 34 | Add verifier README quickstart | `codex/verifier-quickstart` | `examples/sample-receipts/README.md`, `README.md` | Make 5-minute offline verification path clearer. | `npm run docs:check && npm run claims:check` | `verifier: improve offline quickstart` | Low | No |
| 35 | Add machine-readable verifier report | `codex/verifier-json-report` | `tools/ghost-verify.mjs`, tests | Add optional JSON output with pass/fail reasons. | `npm test -- tests/unit/receipt-schema` | `verifier: emit json verification report` | Medium | No |
| 36 | Add verifier golden vector manifest | `codex/verifier-golden-manifest` | `examples/sample-receipts/golden-vectors.json`, tests | List expected digests/signature verdicts for offline verifier. | `npm test -- tests/unit/receipt-schema` | `verifier: add receipt golden vector manifest` | Medium | No |

## README And GitHub Traction

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 37 | Rewrite README opening for 30-second clarity | `codex/readme-opening-clarity` | `README.md` | Make first screen say bounded receipts, AWS-native, non-claims, quickstart. | `npm run docs:check && npm run claims:check` | `docs: sharpen readme opening` | Low | No |
| 38 | Add architecture diagram source | `codex/readme-architecture-diagram` | `docs/architecture/system-overview.md`, `README.md` | Add Mermaid diagram for receipt/control planes. | `npm run docs:check && npm run claims:check` | `docs: add architecture diagram source` | Low | No |
| 39 | Add example receipt bundle walkthrough | `codex/readme-receipt-walkthrough` | `examples/sample-receipts/README.md`, `README.md` | Walk through receipt fields, key, tenant, and failure cases. | `npm run docs:check && npm run claims:check` | `docs: add receipt bundle walkthrough` | Low | No |
| 40 | Add GitHub issue starter pack | `codex/readme-issue-starter-pack` | `.github/ISSUE_TEMPLATE/**`, `docs/operations/AGENT_LABELS.md` | Add bug, research-question, good-first-issue templates. | `npm run docs:check` | `docs: add github issue starter pack` | Low | No |
| 41 | Add demo GIF storyboard | `codex/readme-demo-storyboard` | `docs/product/DEMO_STORYBOARD.md` | Specify terminal steps and UI frames for a future GIF; no generated media. | `npm run docs:check && npm run claims:check` | `docs: add demo storyboard` | Low | No |

## CI And Security

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 42 | Add npm audit advisory note | `codex/ci-npm-audit-note` | `.github/workflows/ci.yml`, docs | Add optional `npm audit --audit-level=high` discussion or non-blocking job. | `npm run validate` | `ci: add dependency audit note` | Medium | No |
| 43 | Add workflow permissions audit doc | `codex/ci-workflow-permissions-doc` | `docs/security/SECURITY_REVIEW_BACKLOG.md`, `.github/workflows/*.yml` | Document current permissions and reduce if tests prove safe. | `npm run validate` | `ci: document workflow permissions` | Medium | No |
| 44 | Add Semgrep result triage runbook | `codex/security-semgrep-runbook` | `docs/security/SEMGREP_TRIAGE.md` | Add severity policy and false-positive handling. | `npm run docs:check` | `security: add semgrep triage runbook` | Low | No |
| 45 | Add secret-scanning local instructions | `codex/security-local-secrets` | `docs/security/SECRET_SCANNING.md` | Document gitleaks local command and agent handling. | `npm run docs:check && npm run claims:check` | `security: add local secret scanning guide` | Low | No |
| 46 | Add agent supply-chain threat model | `codex/security-agent-supply-chain` | `docs/security/AGENT_SUPPLY_CHAIN.md` | Document malicious setup scripts, prompt injection, and network egress risk. | `npm run docs:check && npm run claims:check` | `security: add agent supply-chain threat model` | Low | No |

## AWS Live Validation Later

| # | Issue title | Branch | Files to edit | Plan | Exact tests | Commit | Risk | Human approval |
|---|---|---|---|---|---|---|---|---|
| 47 | Add live AWS validation preflight checklist | `codex/aws-validation-preflight` | `docs/operations/runbooks/governed-invoke-validation.md` | Add cost, region, identity, rollback, and evidence-capture checklist. | `npm run docs:check && npm run claims:check` | `aws: add validation preflight checklist` | Low | Yes |
| 48 | Add KMS signing validation evidence template | `codex/aws-kms-evidence-template` | `evidence/live-aws-validation/templates/kms-signing-report.template.json`, docs | Add sanitized report template only. | `npm run docs:check` | `aws: add kms signing evidence template` | Low | Yes |
| 49 | Add Bedrock allowlist live smoke template | `codex/aws-bedrock-smoke-template` | `evidence/live-aws-validation/templates/bedrock-smoke-report.template.json`, docs | Add template and no-live-spend warning. | `npm run docs:check && npm run claims:check` | `aws: add bedrock smoke report template` | Low | Yes |
| 50 | Add Nitro live validation plan | `codex/aws-nitro-live-plan` | `docs/research/NITRO_LIVE_VALIDATION_PLAN.md` | Plan enclave/KMS attestation test with cost and rollback gates. | `npm run docs:check && npm run claims:check` | `aws: document nitro live validation plan` | Medium | Yes |

## When Codex Must Stop

Codex must stop and ask the human before live AWS spend, production deploys, changing KMS/IAM trust boundaries without tests, rotating or exposing keys, changing tenant identity source of truth, claiming cryptographic/formal proof beyond current evidence, modifying public validation evidence, or adding dependencies that execute install scripts.
