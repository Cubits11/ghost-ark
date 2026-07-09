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