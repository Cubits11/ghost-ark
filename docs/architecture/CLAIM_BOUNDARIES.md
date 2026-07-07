Ghost Ark Claim Boundaries
==========================

Purpose
-------

Ghost Ark is an evidence-control plane for bounded assurance claims.

Ghost Ark does not certify that a system is safe.
Ghost Ark does not prove that evidence is true.
Ghost Ark does not replace human review.
Ghost Ark does not transform weak evidence into strong evidence.

Ghost Ark records bounded claims, governance context, tenant identity, evidence references, lineage references, and cryptographic receipts so that later reviewers can inspect exactly what was claimed, when, by whom, under what boundary, and with what signed payload.

Core doctrine
-------------

Every claim must have a boundary.

Every receipt must be inspectable.

Every assurance statement must distinguish between:

- what was observed
- what was enforced
- what was signed
- what was stored
- what remains unknown
- what must not be claimed

Permitted claims
----------------

Ghost Ark may support the following bounded claims when the relevant evidence exists.

Receipt issuance claims:

- A receipt was issued.
- A receipt payload matched the receipt schema.
- A receipt has a deterministic receiptId.
- A receipt includes a tenantSlug.
- A receipt includes a subject.
- A receipt includes one or more evidence object references.
- A receipt includes governance context.
- A receipt includes a signature object.

Signing claims:

- A receipt digest was computed.
- A receipt digest was signed by the configured KMS signing key.
- The signature algorithm was recorded.
- The KMS key identifier or alias was recorded.
- The signedAt timestamp was recorded.

Persistence claims:

- A receipt record exists in DynamoDB.
- A claim record exists in DynamoDB.
- A lineage record exists in DynamoDB.
- A record was retrieved by the expected tenant-scoped key.
- A record has a status such as issued, superseded, revoked, or disputed.

Authentication claims:

- A request included a valid Cognito identity token.
- API Gateway required Cognito authorization for a protected route.
- Cognito authorizer context was available to the Lambda handler.
- A tenant slug was extracted from Cognito claims.

Tenant boundary claims:

- A request was associated with a tenant slug.
- A route used tenantSlug as part of its access path.
- A handler compared requested tenantSlug with authenticated tenantSlug.
- A tested route rejected unauthenticated access.
- A tested route rejected missing tenant identity.

Deployment claims:

- A named CloudFormation stack reached CREATE_COMPLETE or UPDATE_COMPLETE.
- A named API endpoint was deployed.
- A specific commit was tested.
- A specific AWS region and stage were used.
- Search mode was disabled or enabled for a specific deployment.

Forbidden claims
----------------

Ghost Ark must not claim the following without separate evidence, tests, and review.

Truth claims:

- Evidence is true.
- A dataset is correct.
- A model output is correct.
- A policy decision is correct.
- A human review is correct.
- A receipt proves the underlying evidence is accurate.

Safety claims:

- The AI system is safe.
- The application is safe.
- The deployment is safe.
- The architecture is safe.
- The system prevents all harmful outputs.
- The system prevents all misuse.

Compliance claims:

- Compliance is achieved.
- The system is HIPAA compliant.
- The system is SOC 2 compliant.
- The system is ISO compliant.
- The system is GDPR compliant.
- The system is audit-ready in a formal regulatory sense.

Security claims:

- Tenant isolation is fully proven.
- IAM least privilege is fully proven.
- The system is secure.
- The system is penetration-tested.
- The system prevents all replay attacks.
- The system prevents all injection attacks.
- The system prevents all privilege escalation.

Human review claims:

- Human review upgrades weak evidence into strong evidence.
- Human review proves safety.
- Human review proves compliance.
- Human review guarantees correctness.
- Human approval eliminates residual risk.

Receipt overclaiming:

- A receipt means the claim is true.
- A receipt means the evidence is trustworthy.
- A receipt means a control was effective.
- A receipt means the system is production-ready.
- A receipt means deployment safety has been established.

Conditional claims
------------------

Some statements are allowed only when their conditions are explicit.

Receipt verification:

Allowed:

- The receipt signature verified against the expected public key or KMS verification operation.

Only if:

- The verifier recomputed the canonical digest.
- The verifier compared the digest with signature.digestSha256.
- The verifier checked the recorded signing algorithm.
- The verifier checked the expected key identity.
- The verifier returned an explicit PASS result.

Tenant isolation:

Allowed:

- Tenant access was rejected for the tested route and tested principal.

Only if:

- A negative tenant test was executed.
- The tested principal and tenant slug are recorded.
- The route and expected status code are recorded.

Search behavior:

Allowed:

- Search was disabled in the tested core deployment.

Only if:

- The deployment was synthesized or inspected with search disabled.
- Search resources such as OpenSearch, NAT Gateway, and EIP were absent or not introduced.

Not allowed:

- Search behavior is validated.

Unless:

- Search mode is explicitly enabled and tested separately.

Production readiness:

Allowed:

- Development core smoke validation passed.

Not allowed:

- Production readiness passed.

Unless:

- A separate production readiness checklist, security review, operational review, cost review, and rollback plan have been completed.

Relationship to CC-Framework
-----------------------------

CC-Framework defines what may be claimed under bounded evidence conditions.

Ghost Ark records where the evidence, claim, policy context, tenant identity, signature, and receipt exist.

AWS provides the enforcement and evidence substrate.

The separation is:

- CC is the evaluator of claim permission.
- Ghost Ark is the assurance ledger and receipt-control plane.
- AWS is the execution, identity, storage, signing, and observability substrate.
- Human review is a governance input, not a magical evidence upgrade.

Operational rule
----------------

A Ghost Ark PASS means only:

- the specific verifier or smoke test passed
- under the stated configuration
- at the stated time
- for the stated route, receipt, tenant, stack, or artifact
- with the stated exclusions

A Ghost Ark PASS does not mean:

- safe
- compliant
- correct
- production-ready
- fully secure
- universally validated

Required language
-----------------

Use this language:

- bounded validation
- development smoke test
- receipt issued
- digest signed
- tenant-scoped route
- explicit non-claim
- verification pending
- tested boundary
- out of scope

Avoid this language unless formally proven:

- safe
- certified
- compliant
- guaranteed
- production-ready
- fully secure
- proves correctness
- proves alignment
- proves tenant isolation

Design consequence
------------------

Every future Ghost Ark feature should answer at least one of these questions:

- Does this make a claim more bounded?
- Does this make evidence more durable?
- Does this make receipt verification more reproducible?
- Does this make tenant access more explicit?
- Does this reduce false confidence?
- Does this make revocation, dispute, or supersession clearer?

If the answer is no, the feature should not be added yet.
