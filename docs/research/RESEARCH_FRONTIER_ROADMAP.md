Ghost-Ark Research Frontier Roadmap

Purpose

Ghost-Ark is evolving from an AWS-native verifiable AI infrastructure reference architecture into a research-grade system for evidence-bound, confidential, formally specified, privacy-preserving, externally auditable AI governance.

This roadmap is intentionally staged.

Ghost-Ark must not claim hardware attestation, formal verification, zero-knowledge execution, decentralized transparency, CC-Framework integration, production readiness, compliance, or AI safety unless each claim is backed by executable evidence at the appropriate maturity level.

The governing principle is:

Vocabulary must not outrun evidence.

Research Thesis

Modern AI governance fails when high-level claims outrun the evidence chain that supports them.

Ghost-Ark’s research direction is to make AI governance claims:

* receipt-bound
* replayable
* scoped
* tenant-aware
* policy-bound
* cryptographically verifiable
* assumption-explicit
* externally auditable where artifacts permit

Ghost-Ark does not attempt to prove that model outputs are true, safe, aligned, compliant, or production-ready. It attempts to make claims about AI-system execution, policy decisions, evidence transformations, and verification boundaries harder to overstate.

Maturity Control

All roadmap items are governed by:

docs/research/ASSURANCE_MATURITY_LADDER.md
docs/research/CLAIM_EVIDENCE_MATRIX.md

Every phase must identify:

* current maturity level
* evidence artifacts
* validation commands
* missing evidence
* allowed claims
* forbidden claims
* non-claims
* downgrade triggers

A phase name is not a claim. A roadmap item is not evidence. A schema is not implementation. A test is not deployment. A smoke run is not external reproducibility. A proof only proves the exact statement it encodes.

Phase 0: Research Control Plane

Goal

Define the manifests, schemas, verification interfaces, threat boundaries, and claim-classification rules required before any advanced assurance claim is accepted.

Current maturity

L1-L2 depending on artifact

Deliverables

* assurance maturity ladder
* claim evidence matrix
* frontier manifest schema
* threat model
* attestation manifest schema
* formal invariant registry
* zk receipt interface schema
* witness checkpoint schema
* verification CLI skeleton
* local fixture conventions
* non-claim registry

Success criterion

A reviewer can inspect:

* what Ghost-Ark claims
* what Ghost-Ark does not claim
* what evidence supports each claim
* what command verifies each artifact
* what evidence is missing before a stronger claim is allowed

Allowed claims

* Ghost-Ark defines claim-boundary controls for advanced assurance work.
* Ghost-Ark documents the evidence required before advanced assurance claims can be made.
* Ghost-Ark separates research interfaces from implemented runtime evidence.

Forbidden claims

* Ghost-Ark is production-ready.
* Ghost-Ark is enterprise-ready.
* Ghost-Ark establishes bounded receipt-verification evidence under stated verifier rules.
* Ghost-Ark provides formal verification, zk execution, Nitro security, or decentralized transparency before executable evidence exists.

Phase 1: Receipt-Bound Evidence Core

Goal

Establish the local evidence substrate: canonical receipts, digest binding, signature verification, checkpoint roots, witness consistency proofs, and verifier output boundaries.

Current maturity

L3-L4 for local primitives and integration-tested verifier paths, depending on component

Deliverables

* canonical receipt schemas
* local receipt verifier
* sample signed receipt
* tamper fixtures
* checkpoint root primitive
* witness checkpoint consistency proof
* local research witness bundle
* verification reports
* fail-closed verifier behavior

Success criterion

A reviewer can run local commands and observe deterministic pass/fail behavior for signed receipts, digest bindings, tenant expectations, checkpoint consistency proofs, and tamper cases.

Allowed claims

* Ghost-Ark can locally verify supplied signed receipt artifacts under Ghost-Ark verifier rules.
* Ghost-Ark can locally verify research witness checkpoint consistency artifacts under Ghost-Ark verifier rules.
* Ghost-Ark supports deterministic local evidence-integrity checks for specific fixtures.

Forbidden claims

* Ghost-Ark proves evidence truth.
* Ghost-Ark establishes bounded receipt-verification evidence under stated verifier rules.
* Ghost-Ark has independent witness transparency.
* Ghost-Ark provides production tamper-proof logging.
* Ghost-Ark provides external reproducibility unless public bundles and pinned hashes are published.

Phase 2: CC-Ghost Discretization Bridge

Goal

Define and verify the bridge between Ghost-Ark execution evidence and CC-Framework statistical analysis.

The central problem is the discretization step: raw, continuous, stochastic, or textual guardrail outputs must be converted into binary variables before CC-Framework can compute dependence-aware bounds. That conversion must not be an unrecorded software detail.

Current maturity

L1 after documentation
L2 after schema and examples
L3 after local rule legality tests
L4 after integration tests verify observations against rule receipts
L6 after a public replayable CC-Ghost evidence bundle exists

Deliverables

* CC_GHOST_DISCRETIZATION_CONTRACT.md
* ghost.discretization_rule_receipt.v1
* binary observation fixture
* monotonic risk invariant tests
* rule-to-observation verifier
* CC evidence bundle schema
* CC-Framework adapter
* end-to-end CC bounds replay fixture
* Ghost-signed CC claim envelope

Success criterion

A reviewer can verify that a bounded guardrail score was converted into a CC-compatible binary variable only through a receipt-bound rule containing:

* score domain
* threshold
* comparator
* score polarity
* failure semantics
* calibration digest
* scoring function digest
* policy digest
* validity window
* parent trace lineage
* stationarity declaration

Allowed claims

* Ghost-Ark defines a receipt-bound discretization contract for CC-compatible binary variables.
* Ghost-Ark can locally verify that a binary observation matches a signed discretization rule.
* CC-Framework can consume Ghost-Ark-derived binary variables only after provenance and rule preconditions are represented.

Forbidden claims

* The scoring model is valid.
* The threshold is optimal.
* The calibration dataset is representative.
* The observed score distribution is stationary.
* The resulting CC bounds quantify stated dependence assumptions and do not establish broad AI-safety assurance.
* The bridge proves deployment correctness.

Phase A: Nitro Enclave Attestation

Goal

Bind secret release, receipt signing, or high-sensitivity verification operations to measured enclave code identity.

Current maturity

L0-L2 until real enclave build and attestation evidence exists

Deliverables

* attestation manifest schema
* PCR field schema
* enclave image measurement instructions
* attestation document parser
* KMS attestation-bound policy
* sample attestation document
* enclave signing or decrypt path
* AWS evidence bundle
* external verifier instructions

Claims allowed only after implementation

* The enclave image file measurement is reproducibly generated.
* The attestation document is parsed and checked.
* PCR0, PCR1, PCR2, and PCR8 are recorded and checked.
* KMS decrypt or signing access is conditioned on matching attestation measurements.
* Parent instance compromise alone is insufficient to extract enclave-sealed secrets under the stated threat model.

Non-claims

* Nitro Enclaves do not prove that the policy is logically correct.
* Nitro Enclaves do not prove the model output is safe.
* Nitro Enclaves do not remove all side-channel risk.
* Nitro Enclaves do not remove all supply-chain risk.
* Nitro Enclaves do not prove AWS itself is correct.
* Nitro Enclaves do not prove production readiness by themselves.

Upgrade path

L1: documented enclave threat model
L2: attestation manifest schema and examples
L3: local parser and manifest tests
L5: live enclave build and KMS attestation-bound operation
L6: external verifier can check preserved attestation bundle
L7: independent auditor or monitor confirms evidence

Phase B: Formal Policy Verification

Goal

Make tenant isolation, deny precedence, consent gating, and policy compilation invariants precise through formal models and checked artifacts.

Current maturity

L1-L2 for model stubs
L8 only after reproducible checker/proof artifacts exist for exact statements

Deliverables

* TLA+ tenant-isolation model
* finite model configuration
* invariant registry
* TLC or Apalache run instructions
* checker output artifacts
* broken-model/mutant tests
* deny-precedence model
* consent-gated memory model
* policy-compiler semantic model
* refinement notes mapping model actions to TypeScript traces
* optional AWS IAM policy-simulation differential tests with explicit approval

Claims allowed only after implementation

* The finite tenant-isolation model satisfies NoCrossTenantAllow for the recorded configuration.
* Deny precedence is preserved in the specified formal model.
* Policy compilation preserves intended semantics for the modeled fragment.
* Differential checks against AWS IAM semantics pass for the supported policy fragment and recorded environment.

Non-claims

* Bounded model checking is not a proof over all possible AWS behavior.
* A formal model is only as complete as its assumptions.
* A checked model does not automatically prove the TypeScript implementation.
* A checked model does not prove AWS IAM, Cognito, Lambda, DynamoDB, KMS, Bedrock, OpenSearch, or S3 correctness.
* Formal policy verification does not prove model safety or semantic truth.

Upgrade path

L1: documented invariant
L2: tracked model/config artifact
L3/L4: local checker output for finite model
L8: reproducible formal proof or model-checking artifact for an exact statement

Phase C: Zero-Knowledge Execution Receipts

Goal

Prove selected governance computations executed correctly without revealing private inputs.

This phase is about verifiable governance computations, not full LLM inference.

Current maturity

L0-L2 until real proof artifacts exist

Deliverables

* zk receipt interface schema
* public journal contract
* guest image digest contract
* policy hash binding
* decision hash binding
* prompt/context commitment strategy
* canonical output commitment
* verifier adapter
* sample proof artifact
* reproducible proof generation instructions

Claims allowed only after implementation

* A verifier can check that a specific guest image ID produced a public journal.
* The receipt binds policy hash, decision hash, canonical input commitment, and canonical output commitment.
* Private prompt or context material is not disclosed in the public journal under the stated commitment scheme.
* The verifier accepts valid receipts and rejects tampered public inputs.

Non-claims

* zkVM receipts do not prove semantic model safety.
* zkVM receipts do not prove that the encoded policy is good.
* zkVM receipts do not make large LLM inference cheap by default.
* A zk proof only covers the program actually encoded into the guest.
* A zk proof does not prove production privacy unless the full data-flow and side-channel boundary are covered.

Upgrade path

L1: documented zk receipt boundary
L2: schema and mock fixture
L3: verifier adapter tests against mock fixtures
L8: real proof artifact, verifier implementation, public inputs, and reproduction command

Phase D: Witness-Cosigned Transparency

Goal

Prevent unilateral operator rewriting, deletion, or split-view logging of governance receipts.

Current maturity

L3-L4 for local/dev witness mechanics if tested
L7 only after independent witnesses or monitors exist

Deliverables

* Merkle checkpoint schema
* consistency proof schema
* witness key manifest
* local witness bundle generator
* checkpoint verifier
* witness signature verifier
* monitor protocol
* public checkpoint publication path
* independent witness onboarding instructions
* split-view detection story
* externally replayable witness bundles

Claims allowed only after implementation

* Checkpoints are Merkle-rooted.
* Local witness signatures verify for supplied fixtures.
* Independent witnesses sign checkpoint roots.
* Monitors verify consistency between checkpoints.
* Clients can verify inclusion proofs and witness signatures.

Non-claims

* Witnesses do not prove the original policy decision was correct.
* Transparency does not provide confidentiality by itself.
* A local dev witness is not decentralization.
* A maintainer-controlled witness is not independent.
* Consistency proofs do not prove semantic correctness, AI safety, compliance, or deployment correctness.

Upgrade path

L2: schema and fixture
L3: unit-tested Merkle and signature primitives
L4: integration-tested witness bundle verification
L6: public replayable bundle with verifier CLI and pinned hashes
L7: independent witness or monitor confirmation

Phase E: External Evidence Capsules

Goal

Package Ghost-Ark evidence into externally replayable capsules that can be verified without trusting a live Ghost-Ark server.

Current maturity

L4-L6 depending on whether public replay bundles and pinned hashes exist

Deliverables

* evidence capsule manifest
* pinned artifact hashes
* schemas
* receipt bundle
* checkpoint bundle
* verification report
* local verifier command
* public artifact publication instructions
* downgrade/staleness metadata

Success criterion

A third party can clone the repository, run one verification command, and reproduce the stated pass/fail result without private database access or live cloud credentials.

Allowed claims

* This evidence capsule is externally replayable from published artifacts.
* The verifier checks canonical hashes, signatures, receipt bindings, and checkpoint consistency for this capsule.

Forbidden claims

* The capsule proves evidence truth.
* The capsule proves model safety.
* The capsule proves compliance.
* The capsule proves production readiness.

Phase F: Live AWS Runtime Validation

Goal

Validate selected Ghost-Ark runtime paths against live AWS infrastructure while preserving sanitized evidence for later replay.

Current maturity

L5 only for specific preserved live runs

Deliverables

* deployed stack metadata
* account/region/stage scope
* CloudWatch logs
* KMS signing or verification output
* API smoke report
* generated receipts
* sanitized evidence bundle
* teardown notes
* cost-control notes
* replay boundary statement

Success criterion

A reviewer can inspect a preserved run and understand:

* which AWS account and region were used
* which stage was tested
* which command was run
* which receipt was generated
* which KMS key or signer was used
* what evidence was preserved
* what cannot be replayed without private access

Allowed claims

* Ghost-Ark has live AWS validation evidence for the named run.
* Ghost-Ark emitted a governed invocation receipt in a dev AWS deployment for the recorded scope.

Forbidden claims

* Ghost-Ark is production-ready.
* Ghost-Ark is enterprise-ready.
* Ghost-Ark is compliant.
* Ghost-Ark is continuously validated.
* Ghost-Ark proves safe model behavior.

Unified Research End-State

The long-term research end-state is a layered evidence pipeline:

Governed execution
  -> signed execution receipt
  -> guardrail score observation
  -> receipt-bound discretization rule
  -> CC-compatible binary observation
  -> dependence-aware CC bounds report
  -> signed claim envelope
  -> checkpointed evidence capsule
  -> externally replayable verifier
  -> independent witness or formal proof where applicable

The target contribution is not a generic AI safety platform.

The target contribution is:

Evidence-bound AI governance infrastructure for converting recorded execution behavior into scoped, replayable, assumption-explicit claims.

Global Non-Claims

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
* hardware isolation without enclave evidence
* zero-knowledge execution without real proof artifacts
* formal correctness without executable proof evidence
* independent transparency without independent witnesses or monitors

Research Culture Rule

Every phase must preserve the distinction between:

integrity
validity
confidentiality
availability
correctness
safety
compliance
production readiness

A result in one category must not be marketed as a result in another category.

Final Rule

Do not announce frontier capabilities before the artifacts exist.

If the phase has only a document, call it documented.

If it has a schema, call it schema-bound.

If it has tests, call it locally tested.

If it has live AWS evidence, call it cloud-validated for that run.

If it has public replay artifacts, call it externally verifiable for that bundle.

If it has independent witnesses, call it independently witnessed.

If it has a proof, state exactly what the proof proves.

Nothing more.