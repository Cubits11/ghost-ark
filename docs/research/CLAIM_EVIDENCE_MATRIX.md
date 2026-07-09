# Ghost-Ark Claim Evidence Matrix

Ghost-Ark separates implemented behavior, locally verifiable artifacts, AWS validation candidates, research-only interfaces, and future work. This matrix exists to prevent public claims from exceeding checked evidence.

## Claim Classification Rule

Every public claim must identify:

- claim text
- maturity level
- evidence artifact
- local or AWS validation command
- missing evidence
- allowed wording
- forbidden wording

Use `docs/research/ASSURANCE_MATURITY_LADDER.md` as the source of truth for maturity levels.

## Current Matrix

| Claim | Current Level | Evidence | Validation Command | Missing Evidence | Allowed Public Wording | Forbidden Wording |
|---|---:|---|---|---|---|---|
| Ghost-Ark can locally verify a signed sample receipt. | L3 | `tools/ghost-verify.mjs`, `examples/sample-receipts/valid-receipt.json`, `examples/sample-receipts/public-key.pem` | `npm run ghost-verify -- --receipt examples/sample-receipts/valid-receipt.json --key examples/sample-receipts/public-key.pem --tenant acme-lab` | More golden fixtures and tamper cases. | Ghost-Ark can locally verify canonical receipt identity, tenant binding, digest binding, and RSA-PSS signature validity for the supplied sample artifact. | Ghost-Ark proves the AI output is true, safe, compliant, or production-ready. |
| Ghost-Ark has deterministic receipt and checkpoint primitives. | L3 | `packages/enforcement-runtime/src/receipts/checkpoint.ts` | `npm test` | External witness publication and independent monitor evidence. | Ghost-Ark can compute deterministic local checkpoint roots under its verifier rules. | Ghost-Ark provides tamper-proof or independently witnessed transparency. |
| Ghost-Ark has AWS-native deployment scaffolding. | L2-L4 depending on component | `infra/cdk`, `infra/terraform`, `services/**`, `apps/api/**` | `npm run validate`, `terraform validate`, `npx cdk synth` | Continuous live AWS validation evidence, IAM snapshots, recovery tests, and production review. | Ghost-Ark includes AWS CDK/Terraform scaffolding and AWS validation candidate paths. | Do not describe Ghost-Ark as ready for enterprise production operation. |
| Ghost-Ark supports governed invocation receipt emission in candidate AWS mode. | L4-L5 only after checked live evidence | `apps/api/**`, `packages/enforcement-runtime/**`, `tools/scripts/smokeGovernedInvoke.ts` | `npm run smoke:governed-invoke -- ...` only with explicit human approval and AWS credentials | Sanitized live evidence, CloudWatch logs, KMS verification output, and regression pipeline. | Ghost-Ark has a governed invocation path designed to emit decision receipts. | Do not describe Ghost-Ark as guaranteeing model behavior safety or deployment correctness. |
| Ghost-Ark models Nitro attestation boundaries. | L1-L2 | `docs/research/**`, attestation-related schemas or stubs when present | Local schema/unit tests only | Real Nitro Enclave build, attestation document parser, PCR measurement evidence, KMS attestation-bound key release. | Ghost-Ark documents Nitro attestation boundaries and future validation requirements. | Ghost-Ark provides production enclave security. |
| Ghost-Ark models zk receipt boundaries. | L1-L2 | research docs, mock or schema-only interfaces when present | Local mock/schema tests only | Real SP1/RISC Zero proof generation, verifier adapter, public journal commitments, reproducible proof artifacts. | Ghost-Ark defines research interfaces for future zk receipt verification. | Ghost-Ark executes or verifies real zero-knowledge proofs unless real proof artifacts are checked in. |
| Ghost-Ark uses claim-boundary scanning. | L3 | `tools/research/check-forbidden-claims.mjs` | `npm run claims:check` | Unicode/homoglyph negative tests and broader semantic review. | Ghost-Ark includes a CI-enforced forbidden-claim scanner for known overclaim patterns. | Ghost-Ark is immune to false advertising or all developer overclaim drift. |

## Required Non-Claims

Ghost-Ark does not prove:

- AI safety
- model alignment
- model output truthfulness
- legal or regulatory compliance
- production readiness
- hardware isolation on non-enclave runtimes
- zero-knowledge execution without real proof artifacts
- formal correctness without executable formal proof evidence

## Reviewer Rule

If a README, paper, social post, diagram, demo, or release note contains a claim that cannot be mapped to this matrix or to the assurance maturity ladder, rewrite the claim before publishing.
