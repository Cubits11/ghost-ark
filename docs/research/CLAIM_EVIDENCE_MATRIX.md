Ghost-Ark Claim Evidence Matrix

Purpose

Ghost-Ark separates implemented behavior, locally verifiable artifacts, AWS validation candidates, research-only interfaces, externally reproducible evidence, and future work.

This matrix exists to prevent public claims from exceeding checked evidence.

A claim is allowed only when its maturity level, evidence artifact, verification command, missing evidence, and non-claims are explicit.

Source of Truth

Use docs/research/ASSURANCE_MATURITY_LADDER.md as the source of truth for maturity levels.

This matrix classifies current Ghost-Ark claims against that ladder. If the ladder and this matrix disagree, downgrade the claim until the supporting evidence is clear.

Claim Classification Rule

Every public claim must identify:

* claim text
* current maturity level
* evidence artifact
* local, AWS, or external validation command
* missing evidence
* allowed wording
* forbidden wording
* non-claims

A claim that cannot be mapped to this matrix or the maturity ladder must be rewritten, downgraded, or removed.

Current Matrix

Claim	Current Level	Evidence	Validation Command	Missing Evidence	Allowed Public Wording	Forbidden Wording
Ghost-Ark can locally verify a signed sample receipt.	L3	tools/ghost-verify.mjs, examples/sample-receipts/valid-receipt.json, examples/sample-receipts/public-key.pem	npm run ghost-verify -- --receipt examples/sample-receipts/valid-receipt.json --key examples/sample-receipts/public-key.pem --tenant acme-lab	More golden fixtures, tamper corpus, pinned verification reports, and public release bundle.	Ghost-Ark can locally verify canonical receipt identity, tenant binding, digest binding, and RSA-PSS signature validity for the supplied sample artifact.	Ghost-Ark proves the AI output is true, safe, compliant, deployment-correct, or production-ready.
Ghost-Ark has deterministic receipt and checkpoint primitives.	L3	Receipt and checkpoint packages, unit tests, local verifier behavior.	npm test or focused receipt/checkpoint test commands.	Public checkpoint bundle, external monitor evidence, independent witness publication.	Ghost-Ark can compute deterministic local checkpoint roots under its verifier rules.	Ghost-Ark provides tamper-proof, decentralized, independently witnessed transparency.
Ghost-Ark can generate and verify local research witness checkpoint consistency bundles.	L4	tools/scripts/createResearchWitnessBundle.ts, local witness bundle examples, verifier integration tests.	npm run research:witness-bundle -- --out examples/research/witness-bundle.local; node tools/ghost-verify.mjs --witness-checkpoint-consistency-proof ...	Published golden bundle, pinned hashes, external verifier report, independent witness keys.	Ghost-Ark can generate and locally verify a research witness checkpoint consistency bundle under Ghost-Ark verifier rules.	Ghost-Ark has decentralized transparency, independent witness confirmation, or public monitor verification.
Ghost-Ark defines a CC-Ghost discretization contract.	L1-L2 initially; L3-L4 after tests	docs/research/CC_GHOST_DISCRETIZATION_CONTRACT.md, schemas/ghost_discretization_rule_receipt.v1.json, examples/cc-ghost/**, discretization contract tests.	npx vitest run tests/integration/tools/ccGhostDiscretizationContract.test.ts after implementation.	CLI verifier, signed receipt envelope, CC-Framework adapter, end-to-end CC bounds replay, external artifact bundle.	Ghost-Ark defines and tests a local contract for mapping bounded guardrail scores into CC-compatible binary variables under explicit rule preconditions.	Ghost-Ark proves scoring validity, threshold optimality, calibration quality, AI safety, statistical validity, or real-world stationarity.
Ghost-Ark has AWS-native deployment scaffolding.	L2-L4 depending on component	infra/cdk, infra/terraform, services/**, apps/api/**, local synthesis and tests.	npm run validate, terraform validate, npx cdk synth	Continuous live AWS validation evidence, IAM snapshots, recovery tests, threat-model review, production readiness review.	Ghost-Ark includes AWS CDK/Terraform scaffolding and AWS validation candidate paths.	Ghost-Ark is enterprise-ready, production-ready, compliant, or operationally hardened by default.
Ghost-Ark supports governed invocation receipt emission in candidate AWS mode.	L4 locally; L5 only after checked live evidence	apps/api/**, packages/enforcement-runtime/**, tools/scripts/smokeGovernedInvoke.ts, governed invoke tests.	Local: npm test; AWS: npm run smoke:governed-invoke -- ... only with explicit human approval and AWS credentials.	Sanitized live evidence, CloudWatch logs, KMS verification output, deployed stack metadata, regression pipeline, preserved smoke reports.	Ghost-Ark has a governed invocation path designed to emit decision receipts and fail closed under tested local conditions.	Ghost-Ark guarantees safe model behavior, correct deployment decisions, compliant outputs, or production-grade runtime assurance.
Ghost-Ark uses claim-boundary scanning.	L3	tools/research/check-forbidden-claims.mjs, scanner tests, CI claim checks.	npm run claims:check	Unicode/homoglyph negative tests, broader semantic review, generated-doc coverage, public claim review workflow.	Ghost-Ark includes a CI-enforced forbidden-claim scanner for known overclaim patterns.	Ghost-Ark is immune to false advertising, all semantic overclaim drift, or malicious wording bypasses.
Ghost-Ark models Nitro attestation boundaries.	L1-L2	Research docs, attestation-related schemas, manifest stubs, local tests when present.	Local schema or unit tests only.	Real Nitro Enclave build, attestation document parser, PCR measurement evidence, KMS attestation-bound key release, AWS runtime evidence.	Ghost-Ark documents Nitro attestation boundaries and future validation requirements.	Ghost-Ark provides production enclave security or hardware-isolated execution.
Ghost-Ark models zk receipt boundaries.	L1-L2	Research docs, mock interfaces, schema-only receipts, reserved proof-system tests where present.	Local mock/schema tests only.	Real SP1/RISC Zero proof generation, verifier adapter, public journal commitments, reproducible proof artifacts.	Ghost-Ark defines research interfaces for future zk receipt verification.	Ghost-Ark executes, verifies, or proves real zero-knowledge execution unless real proof artifacts are checked in and verified.
Ghost-Ark has bounded tenant isolation checks.	L3-L5 depending on evidence	Tenant validation logic, policy tests, API tenant-boundary tests, AWS-gated smoke tests when run.	Local: npm test; AWS-gated tests only with explicit approval and credentials.	Live IAM simulation evidence, AWS tenant-boundary smoke reports, retained logs, external review.	Ghost-Ark rejects tested client-declared tenant overrides and includes tenant-boundary validation paths.	Ghost-Ark has formally verified multi-tenant isolation or production tenant security.
Ghost-Ark has OpenSearch/SigV4 search integration boundaries.	L2-L4 depending on component	Search handlers, templates, SigV4 tests, CDK wiring.	Focused search tests and npm run validate.	Live domain validation, IAM snapshot, network path evidence, production hardening review.	Ghost-Ark includes tested local boundaries for search integration and scoped AWS wiring.	Ghost-Ark provides production search security or complete data-governance assurance.
Ghost-Ark can produce AWS runtime validation evidence.	L5 only for specific preserved runs	Smoke reports, CloudWatch excerpts, KMS verification output, receipt artifacts, stack metadata.	Specific run command and preserved report path must be named.	External replay bundle, public verifier report, independent witness/auditor evidence.	Ghost-Ark has live AWS validation evidence for the named run, account scope, region, stage, and timestamp.	Ghost-Ark is production-ready, enterprise-ready, compliant, or continuously validated by default.

Required Non-Claims

Ghost-Ark does not prove:

* AI safety
* model alignment
* model output truthfulness
* semantic correctness
* legal or regulatory compliance
* production readiness
* deployment correctness
* threshold optimality
* calibration quality
* dataset representativeness
* real-world stationarity
* hardware isolation on non-enclave runtimes
* zero-knowledge execution without real proof artifacts
* formal correctness without executable formal proof evidence
* independent transparency without independent witnesses or monitors

CC-Ghost Bridge Claim Rule

Any claim involving CC-Framework integration must identify which layer is being claimed:

Layer	Claim Boundary
Ghost-Ark discretization rule receipt	Defines how a score becomes a binary variable. It does not prove the score is valid.
Ghost-Ark binary observation	Records the result of applying a rule. It does not prove the threshold is optimal.
CC evidence bundle	Provides CC-compatible binary variables and provenance. It does not prove safety.
CC-Framework bounds report	Computes what follows under stated assumptions. It does not validate upstream data collection.
Ghost signed claim envelope	Binds evidence, assumptions, and result digest. It does not make the claim broader than the evidence.

CC-Framework must not consume naked binary labels from Ghost-Ark. Binary variables must be tied to a discretization rule, threshold, comparator, calibration digest, scoring digest, validity window, and parent evidence lineage.

Evidence Freshness Rule

Claims tied to live infrastructure, cloud validation, model behavior, policy configuration, or external dependencies must include a validation date or artifact timestamp.

A stale claim must be downgraded or marked stale if:

* the verifier command no longer works
* the artifact is missing
* the schema changed without migration notes
* the signing key rotated without continuity evidence
* the model, classifier, policy, threshold, or calibration context changed
* the AWS stack no longer exists and no replayable evidence bundle was preserved
* the evidence is private but the claim is public

Public Wording Rules

Prefer

* “locally verifies”
* “schema-bound”
* “unit-tested”
* “integration-tested”
* “AWS validation candidate”
* “live validated for this preserved run”
* “externally replayable from this bundle”
* “under Ghost-Ark verifier rules”
* “under stated assumptions”

Avoid unless supported

* “secure”
* “safe”
* “trusted”
* “production-ready”
* “enterprise-grade”
* “decentralized”
* “formally verified”
* “zero-knowledge”
* “enclave-backed”
* “compliant”
* “audited”

Forbidden without exact evidence

* “proves AI safety”
* “guarantees model safety”
* “proves output truthfulness”
* “certifies compliance”
* “eliminates risk”
* “fully trustless”
* “unbreakable”
* “production-ready enterprise infrastructure”
* “decentralized transparency” without independent witnesses
* “formal proof” without proof artifacts and verifier instructions

Reviewer Rule

If a README, paper, social post, diagram, demo, release note, architecture page, pitch deck, or documentation page contains a claim that cannot be mapped to this matrix or to the assurance maturity ladder, rewrite the claim before publishing.

Final Rule

Every claim must answer:

What is being claimed?
What maturity level supports it?
Which artifact supports it?
Which command verifies it?
What is missing?
What does it explicitly not prove?

If any answer is missing, the claim is not ready for public use.