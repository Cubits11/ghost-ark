Ghost-Ark Formal Methods Notes

Purpose

This document records the current formal-methods boundary for Ghost-Ark.

Ghost-Ark may use formal models, model checking, symbolic reasoning, SMT solving, or proof artifacts to make narrow implementation-adjacent properties more precise. These artifacts must not be described as production correctness, AWS correctness, AI safety, compliance, or deployment-safety evidence unless the exact proof statement supports that claim.

The current formal-methods work is intentionally narrow.

Current Maturity

Current classification under docs/research/ASSURANCE_MATURITY_LADDER.md:

L1: documented design

If proofs/tla/TenantIsolation.tla and proofs/tla/TenantIsolation.cfg are present, reviewed, and tracked, the model can be described as:

L2: schema/model-bound artifact

It must not be described as:

L8: formal or cryptographic proof

unless a reproducible TLC, Apalache, TLA+ proof, SMT, or equivalent checker output artifact is added with instructions to reproduce the result.

Current Model

The current model lives in:

proofs/tla/TenantIsolation.tla
proofs/tla/TenantIsolation.cfg

It models a small tenant-isolation boundary:

* tenants
* resources
* resource ownership
* access requests
* allow decisions
* deny decisions
* append-only access log

The model is intentionally narrow so the invariant can be reviewed without importing unrelated AWS, IAM, networking, storage, or AI-system behavior.

Tenant Isolation Invariant

The current safety invariant is:

NoCrossTenantAllow

Operationally:

If the access log records an allow decision for tenant t and resource r, then owner[r] = t.

This means no logged allow decision may exist when the requesting tenant does not own the requested resource.

Intended Formal Statement

At the current level, the model is best understood as a precise executable sketch of the following property:

For every logged allow decision, the requesting tenant matches the modeled owner of the requested resource.

This is a narrow model property.

It is not yet a verified property of the TypeScript implementation, AWS IAM policies, Cognito authorizers, Lambda handlers, DynamoDB records, or live cloud deployment.

What This Model Covers

The model covers:

* finite tenant set
* finite resource set
* resource ownership mapping
* access requests
* allow decisions
* deny decisions
* logged decisions
* append-only access-log shape
* one tenant-isolation safety invariant

What This Model Does Not Cover

This model does not cover:

* AWS IAM evaluation
* Cognito authentication or authorizer behavior
* API Gateway routing
* Lambda execution
* DynamoDB consistency or conditional writes
* KMS signing behavior
* Bedrock invocation
* OpenSearch indexing
* S3 storage
* Nitro Enclaves
* zk proof generation
* receipt canonicalization
* production hash-chain behavior
* policy-compiler semantics
* tenant namespace derivation
* consent-gated memory access
* retrieval taint filtering
* cross-region behavior
* key rotation
* replay resistance
* liveness
* fairness
* real concurrency beyond the modeled next-state relation
* refinement from implementation traces

Second Model: ProvenanceLattice

A second narrow model lives in:

proofs/tla/ProvenanceLattice.tla
proofs/tla/ProvenanceLattice.cfg

It models the evidence provenance lattice from docs/research/EVIDENCE_PROVENANCE_LATTICE.md:

* rank chain 0..4 with rank 3 derive-only
* evidence records labeled with assignable ranks
* meet-based delegation admission
* floor evaluation over distinct qualifying sources

Invariants: TypeOK, NoDeriveOnlyAssignment, NoLaundering (admitted rank bounded by both the claimed rank and the re-verified rank; bounding by the re-verified rank alone is not the meet).

Action properties: SatisfiedStable (floor satisfaction is stable under record addition), FloodImmunity (below-floor additions never change the qualifying source set).

Status: checked finite model with recorded checker artifacts.

On 2026-07-14 the model was checked with TLC2 Version 2.19 (08 August 2024, rev 5a47802) for the committed configuration (three sources, MaxRecords 3, Floor 2, K 2):

* Baseline: proofs/tla/artifacts/ProvenanceLattice.tlc.txt — no invariant or property violation; 2,542,529 states generated; 403,949 distinct states; search depth 7. The distinct-state count matches the expectation pre-registered in proofs/tla/README.md before the run.
* Mutant: proofs/tla/artifacts/ProvenanceLatticeMutant.tlc.txt — ProvenanceLatticeMutant.tla permits direct assignment of the derive-only rank; TLC reports the NoDeriveOnlyAssignment invariant violated with a two-state counterexample, demonstrating the invariants are load-bearing rather than vacuous.

Commands used:

java -cp tla2tools.jar tlc2.TLC -workers auto -config ProvenanceLattice.cfg ProvenanceLattice.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config ProvenanceLatticeMutant.cfg ProvenanceLatticeMutant.tla

Allowed wording: the finite ProvenanceLattice model satisfies NoLaundering, NoDeriveOnlyAssignment, SatisfiedStable, and FloodImmunity for the recorded configuration, as checked by the recorded checker artifacts.

Required non-claim: this validates the finite abstraction only. It is not a statement about the TypeScript implementation, the receipt pipeline, gateway behavior, or any AWS deployment. The corresponding TypeScript implementation (packages/enforcement-runtime/src/evidence/provenanceLattice.ts) is unit-tested locally, which is not model checking and not a proof; connecting model to implementation requires a refinement layer as described below.

The refinement boundary stated below applies to this model equally: a checked lattice model would validate the finite abstraction, not the TypeScript implementation, the receipt pipeline, or any AWS behavior.

Third Model: SpeculativeCollapse

Files:

proofs/tla/SpeculativeCollapse.tla
proofs/tla/SpeculativeCollapse.cfg
proofs/tla/SpeculativeCollapseMutant.tla
proofs/tla/SpeculativeCollapseMutant.cfg

It models speculative-collapse semantics for deferred effects: each speculation carries both the rank the gateway recorded for its supporting evidence and the rank the speculative thread claims. The collapse action consults only the gateway rank; the claim is never read.

Invariants: TypeOK, CollapseSound (no effect reaches canonical state below the floor, regardless of claimed rank).

Status: checked finite model with recorded checker artifacts.

On 2026-07-14 both modules were checked with TLC2 Version 2.19 for the committed configuration (two speculation ids, Floor 2):

* Baseline: proofs/tla/artifacts/SpeculativeCollapse.tlc.txt — no invariant violation; 2,301 states generated; 529 distinct states; search depth 5.
* Mutant: proofs/tla/artifacts/SpeculativeCollapseMutant.tlc.txt — CollapseMutant trusts the claimed rank instead of the gateway record; TLC reports CollapseSound violated with a four-state counterexample in which a speculation carrying gateway rank 0 and claimed rank 2 reaches canonical state.

Commands used:

java -cp tla2tools.jar tlc2.TLC -workers auto -config SpeculativeCollapse.cfg SpeculativeCollapse.tla
java -cp tla2tools.jar tlc2.TLC -workers auto -config SpeculativeCollapseMutant.cfg SpeculativeCollapseMutant.tla

Allowed wording: the finite SpeculativeCollapse model satisfies CollapseSound for the recorded configuration, as checked by the recorded checker artifacts, and the claim-trusting mutant violates it.

Required non-claim: this validates the finite abstraction only. It is not a statement about the TypeScript SpeculativeContextManager, process-level forking, CRIU or microVM mechanisms, or any AWS behavior. ProvenanceLattice.tla was not modified for this work; its recorded artifacts bind to its exact text, so speculation is modeled in a separate module.

Fourth Model: TransportBoundary

Files:

proofs/tla/TransportBoundary.tla
proofs/tla/TransportBoundary.cfg
proofs/tla/TransportBoundaryMutant.tla
proofs/tla/TransportBoundaryMutant.cfg

It answers whether silent compromise depends on the transport parser failing closed. The empirical E2E run found a strict HTTP client rejects smuggled trailing bytes and fails closed, but that is a runtime accident of one client, not a proven property. The model treats transport strictness as an explicit assumption (the mode parameter, strict or lenient) and checks that no adversarial transit is both receipt-valid and oracle-clean in EITHER mode. The load-bearing component is the reconciler, not the parser.

Invariants: TypeOK, NoSilentCompromise.

Status: checked finite model with recorded checker artifacts.

On 2026-07-15, checked with TLC2 Version 2.19 for the configuration (Kinds {honest, smuggle, sidechannel}, Modes {strict, lenient}):

* Baseline: proofs/tla/artifacts/TransportBoundary.tlc.txt — no violation; 64 distinct states.
* Mutant: proofs/tla/artifacts/TransportBoundaryMutant.tlc.txt — the reconciler ignores extra wire bytes; TLC reports NoSilentCompromise violated with the counterexample [kind |-> "smuggle", mode |-> "lenient", rv |-> TRUE, oc |-> TRUE].

Process note: an earlier run of both models passed vacuously because the .cfg used unquoted model values (honest) while the .tla compared against string literals ("honest"), so every CASE fell through to FALSE. The mutant passing where it should have failed is what exposed the vacuity — the mutant discipline caught a model that had no teeth. Fixed by quoting the constants as strings.

Allowed wording: the finite TransportBoundary model satisfies NoSilentCompromise for the recorded configuration in both transport modes, as checked by the recorded artifacts, and a reconciler that ignores extra bytes violates it under the lenient mode.

Required non-claim: this validates the finite abstraction only. Transport strictness is modeled as an assumption, not asserted as a property of any real HTTP client. It is not a statement about the TypeScript reconciler, the gateway, or any deployment.

Required Evidence Before Stronger Claims

To claim L2: model-bound artifact

Required evidence:

* tracked TenantIsolation.tla
* tracked TenantIsolation.cfg
* documented invariant
* documented non-claims

Allowed wording:

Ghost-Ark includes a narrow TLA+ model stub for a tenant-isolation access-log invariant.

Forbidden wording:

Ghost-Ark has formally verified tenant isolation.

To claim L3/L4: checked local formal model

Required evidence:

* TLC or equivalent checker command
* saved checker output artifact
* finite configuration
* explicit invariant list
* documented state-space parameters
* negative or mutant model test where practical

Allowed wording:

The finite tenant-isolation model was model-checked for the stated configuration and invariant.

Forbidden wording:

Ghost-Ark implementation tenant isolation is formally verified.

To claim L8: formal proof-backed property

Required evidence:

* reproducible formal proof or model-checking artifact
* proof statement
* assumptions
* checker version
* command to reproduce
* public model/config
* explanation of what implementation surface, if any, the proof refines to

Allowed wording:

The stated TLA+ model satisfies NoCrossTenantAllow under the provided finite configuration, as checked by the recorded checker artifact.

Forbidden wording:

Ghost-Ark proves production tenant isolation.

Non-Claims

This model does not prove the production Ghost-Ark implementation is correct.

This model does not prove AWS IAM, Cognito, API Gateway, Lambda, DynamoDB, KMS, Bedrock, OpenSearch, S3, Nitro Enclaves, or zk systems correct.

This model does not prove model safety, model-output truthfulness, semantic correctness, compliance, or production readiness.

This model has not been reported as model-checked unless a TLC or equivalent output artifact is added.

This model is not a compliance certificate, AI safety certificate, production safety result, or claim that all tenant-isolation behavior has been formally verified.

Refinement Boundary

A TLA+ model property does not automatically apply to implementation code.

To connect this model to implementation behavior, Ghost-Ark would need a refinement argument or trace-mapping layer that connects model actions to implementation events.

Possible refinement anchors:

Model concept	Possible implementation evidence
tenant	trusted Cognito or Lambda-authorizer tenant context
resource	tenant-scoped receipt, policy, vault, memory, or evidence object
owner[r]	stored tenant namespace, partition key, or policy binding
Allow action	handler authorization branch emitting allow decision
Deny action	fail-closed branch or tenant mismatch rejection
accessLog	decision receipt, structured log, or audit event
NoCrossTenantAllow	assertion that no allow receipt exists for mismatched tenant/resource ownership

Until such a refinement layer exists, this model remains a narrow formal sketch, not an implementation proof.

Recommended Checker Artifact Format

When model checking is actually performed, add a checker artifact such as:

proofs/tla/artifacts/TenantIsolation.tlc.txt

The artifact should include:

* checker name
* checker version
* model file
* config file
* invariant checked
* constants or finite sets
* state count
* distinct state count
* diameter if available
* result
* timestamp
* command used

Example claim after artifact exists:

The finite TenantIsolation model was checked with TLC for the provided two-tenant, two-resource configuration and satisfied `NoCrossTenantAllow`.

Required non-claim:

This does not prove production Ghost-Ark tenant isolation, AWS IAM correctness, or deployment safety.

Next Formal-Methods Steps

Near-term candidates:

1. Add TLC run instructions.
2. Add a checked output artifact.
3. Add a deliberately broken model or mutant configuration to demonstrate the invariant catches cross-tenant allow behavior.
4. Model explicit deny precedence.
5. Model policy compilation as a separate refinement boundary.
6. Model tenant namespace derivation.
7. Model consent-gated memory access.
8. Model concurrent receipt writes.
9. Add a refinement map between model actions and TypeScript enforcement traces.
10. Add differential tests against AWS IAM policy simulation for supported policy fragments, using live AWS only with explicit approval.

Public Claim Guidance

Safe wording:

Ghost-Ark includes a narrow formal-methods model stub for tenant-isolation access-log reasoning.

Safe wording after TLC artifact exists:

The finite TenantIsolation model was checked for the recorded configuration and invariant.

Unsafe wording:

Ghost-Ark formally verifies tenant isolation.

Unsafe wording:

Ghost-Ark proves its AWS deployment prevents cross-tenant access.

Unsafe wording:

Ghost-Ark has production-grade formal verification.

Final Boundary

Formal methods are powerful only when the claim is exact.

A small model can clarify an invariant.

A checked model can validate a finite abstraction.

A refinement proof can connect abstraction to implementation.

None of these automatically establish broad AI-safety assurance, regulatory status, production security posture, or correctness of external cloud services.