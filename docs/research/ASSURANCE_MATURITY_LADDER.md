Ghost-Ark Assurance Maturity Ladder

Purpose

Ghost-Ark must distinguish aspirational architecture from implemented, tested, reproducible, externally verifiable assurance.

This ladder defines the maturity level of any security, privacy, cryptographic, formal-methods, AI-governance, evidence-integrity, or deployment-readiness claim made by the project.

It exists to prevent claim inflation.

A claim is not mature because it sounds rigorous. A claim is mature only when its supporting artifacts are durable, scoped, reproducible, and independently inspectable at the level asserted.

Core Rule

Every major README statement, paper claim, architecture diagram, demo script, release note, benchmark, or public-facing assertion must be classifiable under this ladder.

If a claim cannot be classified, it must be rewritten, downgraded, or removed.

Claim Record Format

Every material claim should be expressible as:

Claim:
Maturity:
Scope:
Evidence:
Verification command:
Assumptions:
Non-claims:
Known gaps:
Last validated:

If there is no verification command, the claim must say so explicitly.

Allowed Verb Discipline

Maturity	Allowed verbs	Forbidden verbs
L0	planned, proposed, explored, intended	implemented, verified, proven, supported
L1	documented, specified, designed	implemented, tested, verified, deployed
L2	defined, represented, schema-bound	verified, integrated, production-ready
L3	unit-tested, deterministic locally	cloud-validated, externally verified
L4	integration-tested, subsystem-validated	live-validated, independently confirmed
L5	cloud-validated, runtime-observed	externally reproducible, independently witnessed
L6	externally verifiable, reproducible from artifacts	independently audited, formally proven
L7	independently witnessed, externally monitored	formally proven, universally trustworthy
L8	formally checked, cryptographically proven under stated assumptions	safe, compliant, production-certified, impossible to break

No maturity level permits claims that Ghost-Ark proves AI safety, semantic truth, compliance, deployment correctness, or production readiness unless a separate, explicit certification or proof system exists for that exact claim.

L0: Aspirational Claim

A design idea exists, but no durable project artifact exists yet.

Required evidence

* roadmap note, issue, task list, or research direction
* explicit future-work language
* no implementation claim

Allowed language

* planned
* proposed
* research direction
* future work
* under consideration

Forbidden language

* implemented
* supported
* verified
* proven
* production-ready

Example

Ghost-Ark may eventually support zkVM execution receipts.

Maturity statement

Maturity: L0 aspirational.
Evidence: roadmap only.
Non-claim: no implementation or verification exists yet.

L1: Documented Design

The claim is described in documentation with scope, assumptions, and non-claims.

Required evidence

* design document
* scope statement
* assumptions
* threat model or failure model section where relevant
* non-claims

Allowed language

* documented design
* specified architecture
* proposed mechanism
* threat-modeled design

Forbidden language

* implemented
* tested
* verified
* deployed
* externally reproducible

Example

Ghost-Ark has a documented design for witness-cosigned transparency checkpoints.

Maturity statement

Maturity: L1 documented design.
Evidence: architecture document.
Non-claim: no implementation, witness operation, or external verification is implied.

L2: Schema-Bound Artifact

The claim has a durable typed representation.

Required evidence

At least one of:

* JSON schema
* TypeScript interface
* typed model
* manifest format
* example artifact
* canonical field contract

Additional requirement

The schema must include non-claim language or be linked to a document that defines the claim boundary.

Allowed language

* schema-bound
* represented
* typed
* defined
* fixture-backed

Forbidden language

* verified
* validated in runtime
* externally reproducible
* independently witnessed

Example

Ghost-Ark defines a schema for zk execution receipts.

Maturity statement

Maturity: L2 schema-bound artifact.
Evidence: schema and example artifact.
Non-claim: schema existence does not prove execution, correctness, privacy, or safety.

L3: Unit-Tested Primitive

The claim has deterministic local tests for a narrow primitive.

Required evidence

* unit tests
* negative tests
* deterministic expected outputs
* local test command
* no cloud dependency

Allowed language

* unit-tested
* deterministic locally
* locally verified for fixture inputs
* fail-closed in unit tests

Forbidden language

* cloud-validated
* deployed
* externally verified
* independent witness confirmed
* production-ready

Example

Ghost-Ark can compute deterministic Merkle checkpoint roots locally.

Maturity statement

Maturity: L3 unit-tested primitive.
Evidence: deterministic unit tests.
Verification command: npm test path/to/test
Non-claim: this does not prove live checkpoint publication or external monitoring.

L4: Integration-Tested Subsystem

The claim is tested across multiple internal components.

Required evidence

* integration tests
* realistic fixture data
* failure-mode tests
* local verifier or replay path
* documented command

Allowed language

* integration-tested
* subsystem-validated
* locally replayable
* verifier-checked against fixtures

Forbidden language

* live cloud validated
* independently verified
* externally witnessed
* production-ready

Example

Ghost-Ark can emit and verify decision receipts across runtime and repository boundaries using local fixtures.

Maturity statement

Maturity: L4 integration-tested subsystem.
Evidence: integration tests and fixture receipts.
Verification command: npm test path/to/integration.test.ts
Non-claim: this does not prove live AWS behavior, production security, or deployment correctness.

L5: Cloud-Validated Runtime Evidence

The claim has been validated against live cloud infrastructure.

Required evidence

At least two of:

* AWS command output
* deployed stack metadata
* CloudWatch logs
* KMS signing or verification output
* generated runtime receipts
* API smoke report
* account, region, stage, and timestamp
* sanitized evidence bundle

Required boundary

The evidence must state:

* account or environment scope
* region
* stage
* time of validation
* whether data is synthetic or real
* whether resources still exist
* whether validation is reproducible without private access

Allowed language

* cloud-validated
* observed in dev deployment
* live-runtime smoke tested
* AWS-validated for stated environment

Forbidden language

* externally reproducible
* independently verified
* production-ready
* enterprise-ready
* compliant
* safe

Example

Ghost-Ark emitted a governed invocation receipt from a live AWS dev deployment.

Maturity statement

Maturity: L5 cloud-validated runtime evidence.
Evidence: AWS smoke report, KMS verification output, CloudWatch logs, generated receipt.
Scope: dev account, us-east-1, synthetic tenant.
Non-claim: this does not prove production readiness, compliance, safety, or durable external reproducibility.

L6: Reproducible External Verification

A third party can independently verify the claim from published artifacts without private infrastructure access.

Required evidence

* public verifier CLI
* pinned artifact hashes
* public schemas
* replayable receipt bundle
* verification report
* no private database dependency
* no live Ghost-Ark server dependency
* documented reproduction command

Allowed language

* externally verifiable
* reproducible from published artifacts
* independently replayable
* artifact-verifiable

Forbidden language

* independently witnessed
* audited
* formally proven
* compliant
* production-certified

Example

An external verifier can validate a receipt bundle and checkpoint without trusting the live Ghost-Ark server.

Maturity statement

Maturity: L6 reproducible external verification.
Evidence: public artifact bundle, verifier CLI, pinned hashes, schemas, verification report.
Verification command: npm run verify:bundle
Non-claim: this does not prove evidence truth, safety, compliance, or independent witness operation.

L7: Independent Witness or Auditor Confirmation

The claim is confirmed by independent witnesses, monitors, or auditors outside the project maintainer’s direct control.

Required evidence

At least one of:

* independent witness signatures
* monitor logs
* independently archived checkpoint copies
* consistency-check reports
* third-party audit report
* published witness identity and key material
* independent reproduction notes

Required boundary

The witness or auditor must be independent of the project maintainer.

A local dev witness key, self-hosted monitor, or maintainer-controlled signature does not satisfy L7.

Allowed language

* independently witnessed
* externally monitored
* auditor-confirmed
* witness-cosigned under stated scope

Forbidden language

* formally proven
* universally trustworthy
* decentralized, unless multiple independent parties actually operate the witness set
* safe
* compliant, unless the audit specifically certifies that compliance claim

Example

Multiple independent witnesses cosigned the same Ghost-Ark checkpoint root.

Maturity statement

Maturity: L7 independent witness confirmation.
Evidence: independent witness signatures, monitor logs, consistency checks.
Non-claim: witness signatures confirm checkpoint agreement, not semantic truth, safety, or compliance.

L8: Formal or Cryptographic Proof

The claim is backed by a formal proof, model checker result, SMT proof, zk proof, or equivalent cryptographic proof artifact.

Required evidence

At least one of:

* TLA+ specification and model checker output
* Lean/Coq/Isabelle proof artifact
* SMT proof or solver transcript
* zk receipt
* formally specified verifier
* reproducible proof instructions
* proof-bound public inputs
* proof verifier implementation

Required boundary

The proof must state exactly what is proven and under which assumptions.

A proof of serialization, hash inclusion, or policy binding does not prove AI safety, model truth, compliance, deployment correctness, or production readiness.

Allowed language

* formally checked
* model-checked
* proof-backed under stated assumptions
* cryptographically verified for the specified statement

Forbidden language

* proves AI safety
* proves compliance
* proves semantic correctness
* impossible to break
* production-certified
* fully trustless, unless trust assumptions are fully specified

Example

A verifier checked that a zk receipt binds a public policy hash, decision hash, prompt commitment, output commitment, and guest image digest to a specific proof statement.

Maturity statement

Maturity: L8 formal or cryptographic proof.
Evidence: proof artifact, verifier implementation, public inputs, reproduction command.
Non-claim: the proof verifies the specified relation only; it does not prove that the model output is safe or correct.

Evidence Aging and Downgrade Rule

Maturity is not permanent.

A claim must be downgraded or marked stale if any required evidence is no longer reproducible, inspectable, or applicable.

Downgrade triggers include:

* deleted artifacts
* broken verifier command
* changed schema without migration note
* expired or rotated signing keys without continuity record
* cloud resources destroyed without preserved evidence
* model, policy, classifier, or threshold drift
* missing reproduction instructions
* dependency rot
* unreviewed environment changes
* private-only evidence for a public claim

A stale L5 claim does not become L6 because logs once existed. It becomes stale L5 until artifacts are preserved and externally replayable.

Cross-Repo CC-Framework Boundary

When Ghost-Ark produces evidence intended for CC-Framework, the maturity level applies independently to each layer.

Example:

Ghost-Ark discretization rule receipt: L2 schema-bound artifact
Ghost-Ark discretization verifier: L3 or L4 depending on tests
CC-Framework adapter consumption: L3 after unit tests
End-to-end CC-Ghost evidence bundle: L4 after integration tests
External replay bundle: L6 after public artifact publication

CC-Framework must not treat Ghost-Ark binary variables as valid unless the discretization rule, threshold, comparator, calibration digest, scoring digest, validity window, and parent evidence lineage are represented and verified at the claimed maturity level.

Claim Classification Examples

Claim: Ghost-Ark supports Nitro Enclave attestation

Current maturity during manifest-only implementation:

L2: schema-bound artifact

After deterministic local tests:

L3: unit-tested primitive

After real enclave build and KMS attestation-bound decrypt:

L5: cloud-validated runtime evidence

After external verifier checks release artifacts without private access:

L6: reproducible external verification

Claim: Ghost-Ark proves AI safety

Classification:

Forbidden.

No current artifact can support this claim. Ghost-Ark can provide verifiable execution evidence, not semantic guarantees of model safety.

Claim: Ghost-Ark provides deterministic Merkle checkpoint roots

Classification:

L3 after unit-tested Merkle primitive.

If the roots are included in a replayable public receipt bundle and independently verifiable with pinned hashes, the claim can become L6 for that artifact bundle.

Claim: Ghost-Ark has decentralized witness-cosigned transparency

Classification:

L1 or L2 until independent witnesses exist.

Single local dev witness signatures are not decentralization.

Claim: Ghost-Ark defines a CC-Ghost discretization contract

Classification:

L1 after documentation.
L2 after schema and example artifacts.
L3 after unit tests for rule legality and monotonicity.
L4 after integration tests verify binary observations against rule receipts.
L6 after a public bundle can be replayed by an external verifier.

Required Public-Claim Gate

Before a claim appears in a README, release note, architecture diagram, paper abstract, website, demo script, or social post, it must pass this gate:

1. What exact statement is being made?
2. Which maturity level supports it?
3. What artifact proves that level?
4. What command verifies it?
5. What assumptions are required?
6. What does it explicitly not prove?
7. Is the evidence fresh, public, and reproducible at the claimed level?

If the answer is unclear, the claim must be rewritten.

Final Rule:

Do not let vocabulary outrun evidence.
A receipt is not truth.
A signature is not validity.
A schema is not implementation.
A test is not deployment.
A smoke run is not external reproducibility.
A witness is not independent if you control it.
A proof proves only the statement it actually encodes.
Every Ghost-Ark claim must stay inside the evidence boundary that supports it.