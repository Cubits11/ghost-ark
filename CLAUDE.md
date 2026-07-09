
# CLAUDE.md — Ghost-Ark Repository Instructions

Claude must read this file before making changes in this repository.

Ghost-Ark is an AWS-native reference implementation for bounded governance receipts and deterministic enforcement primitives around LLM/agentic AI applications.

Core claim boundary:

Ghost-Ark provides cryptographic receipts and bounded governance evidence. It verifies what was recorded, signed, policy-bounded, and replayable under Ghost-Ark verifier rules. It does not prove semantic safety, truth, compliance, alignment, production readiness, or deployment correctness.

## Operating Rules

Before modifying files, Claude must state:

1. files to inspect

2. files to create

3. files to modify

4. tests to add or update

5. commands to run

6. risk of the change

7. what will not be claimed

Do not commit unless explicitly instructed.

Do not run AWS deployment commands unless explicitly instructed.

Do not weaken tests, schemas, canonicalization, signature validation, tenant-boundary checks, or claim boundaries.

## Required Validation

For normal changes:

npm run lint

npx vitest run <new-or-modified-test-file>

For significant changes:

npm run lint

npm test

Do not claim success without command output or explicit limitation.

## Non-Claims

Never claim or imply:

- production-ready

- safe AI

- proves safety

- compliant

- compliance-certified

- formally verified

- trustless

- zero-knowledge

- secure by default

- prevents all attacks

- guarantees safety

- unbreakable

- deployment-safety certification

- production enclave security

Allowed only in explicit limitation, warning, policy, research-only, or non-claim contexts.

## Core Project Thesis

Ghost Protocol = doctrine and threat model.

Ghost-Ark = AWS-native evidence/control-plane implementation.

CC-Framework = measurement science for correlated guardrail failure.

Unified thesis:

Verifiable Agent Governance under Correlated Guardrail Failure.

## Current Baseline

Recent known passing baseline:

- npm run lint passes

- npm test passes

- 63/63 test files passed

- 335/335 tests passed

Recent hardening areas:

- receipt canonicalization

- signature envelope validation

- execution nonce consistency

- replay compatibility

- base64 signature validation

- KMS/HMAC signing boundaries

- CDK/security environment assertions

Do not undo these hardening changes.

## Important Directories

apps/

packages/receipt-schema/

packages/enforcement-runtime/

services/

infra/cdk/

infra/terraform/

schemas/

tests/

docs/

examples/

tools/

Be careful with:

packages/receipt-schema/src/hashCanonicalization.ts

packages/enforcement-runtime/src/receipts/canonical.ts

packages/enforcement-runtime/src/receipts/signer.ts

packages/enforcement-runtime/src/receipts/emission.ts

packages/enforcement-runtime/src/receipts/verifier.ts

packages/enforcement-runtime/src/runtime/

packages/enforcement-runtime/src/retrieval/

packages/enforcement-runtime/src/vault/

infra/cdk/lib/api-stack.ts

README.md

## Receipt Rules

Preserve deterministic canonical JSON.

Reject host-language non-JSON objects before signing.

Do not claim RFC 8785 / JCS compliance unless explicitly implemented and tested.

Receipt v1 compatibility matters. Do not change semantic multiplicity of fields such as action_taken without a schema migration.

## Signature Rules

Signing proves signing authorization over the receipt payload. It does not prove the AI output is true or safe.

Local HMAC is dev-only.

KMS signing is intended AWS mode.

KMS key IDs in verification-critical paths should be immutable key ARNs, not mutable aliases.

KMS signing does not prove hardware attestation or runtime integrity.

Do not claim Nitro Enclave/PCR-bound execution integrity unless an explicit AWS-supported attestation flow is implemented and tested.

## AWS Reality Boundary

Never claim the full cloud path exists unless it has live AWS evidence.

Distinguish:

- local-only

- AWS-synth-only

- AWS-live

- research-only

- aspirational

- non-claim

Target cloud architecture:

Cloud Security Evidence Analyst Agent on AWS.

Future path:

API Gateway

Cognito / Lambda authorizer

Governed Invoke Lambda

Policy repository

Server-side retrieval provider

Bedrock Guardrails input assessment

Read-only tool gateway

Allowlisted Bedrock model invocation

Post-model policy and redaction

Bedrock Guardrails output assessment

KMS-signed decision receipt

DynamoDB receipt ledger

S3 Object Lock checkpoint bundle

CloudWatch/X-Ray trace binding

Sanitized evidence bundle

CC-Framework observation export

## Tool Gateway Boundary

Initial agent tools must be read-only.

Allowed initial tools:

- read CloudWatch alarm state

- read DynamoDB receipt metadata

- read sanitized S3 evidence bundles

- query Athena read-only datasets

- search evidence index if configured

- summarize sanitized deployment outputs

Forbidden initial tools:

- delete resources

- modify IAM

- rotate keys

- write production data

- send emails

- create external side effects

- execute arbitrary shell in cloud

No tool use without receipt semantics.

## Frontier Task Preference

If asked to run the frontier cartographer task, prefer this bounded sequence:

1. Create docs/research/INVISIBLE_FRONTIER_PROBLEMS.md

2. Create docs/claims/CLAIM_EVIDENCE_ATTACK_MAP.md

3. Create schemas/ghost_claim_evidence_attack_map.v1.json

4. Create docs/architecture/CLOUD_AGENT_GOVERNANCE_TARGET.md

5. Implement tools/claims/scan-claims.ts

6. Create docs/claims/CLAIM_LANGUAGE_POLICY.md

7. Create tests/integration/claims/claimLanguagePolicy.test.ts

8. Run lint and targeted tests

9. Run full tests if practical

Do not implement Bedrock Guardrails, server-side retrieval, tool gateway, formal model, and claim scanner all in one pass.

## Completion Report

At the end of substantial work, report:

Files created:

Files modified:

Commands run:

Tests:

Security/claim impact:

Remaining gaps:

Next highest-leverage task:

## North Star

A skeptical reviewer should be able to say:

I do not trust the author.

I do not trust the README.

I do not trust the model.

But I can inspect the receipt, replay the canonical digest, verify the signature, map the claim to evidence, inspect the non-claim, and reproduce the failure boundary.

