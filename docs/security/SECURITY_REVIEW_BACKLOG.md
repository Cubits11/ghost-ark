Ghost Ark Security Review Backlog
=================================

Purpose
-------

This document records the security review backlog for Ghost Ark.

Ghost Ark is a development-stage evidence-control plane for bounded assurance claims.

This backlog does not claim that Ghost Ark is secure.
This backlog does not claim production readiness.
This backlog does not claim compliance readiness.
This backlog does not claim complete tenant isolation.
This backlog exists to prevent accidental overclaiming and to make future hardening work explicit.

Current security posture
------------------------

Current validated strengths:

- Cognito user-pool authorization protects synthesized core API methods.
- POST /receipts is protected by Cognito authorization.
- GET /tenants/{tenantSlug}/receipts/{receiptId} is protected by Cognito authorization.
- GET /tenants/{tenantSlug}/claims is protected by Cognito authorization.
- Developer-header tenant authority is disabled in synthesized API Lambda environments.
- Receipt creation rejects client-declared tenant, user, and session fields.
- TypeScript tests cover tenant path mismatch and body tenant override rejection.
- Search route is absent when Search Mode is disabled.
- Search Mode is opt-in.
- Receipt signing uses configured KMS signing infrastructure.
- Receipt verification CLI exists for evidence receipts.
- Receipt tamper tests exist for evidence receipts and local decision receipts.
- Receipt records persist in DynamoDB.
- Local enforcement-runtime primitives exist for deterministic policy evaluation, decision receipts, and memory suppression.
- Dev-core smoke validation is documented.
- Explicit non-claims are documented.

Current known limitations:

- Bedrock invocation is not yet wrapped by the enforcement runtime.
- Decision receipts use a local-dev HMAC signer in tests; production KMS-backed decision receipt signing is not wired.
- Privacy vault behavior is local in-memory test code, not DynamoDB-backed storage.
- Policy storage and retrieval are not yet tenant-scoped AWS resources.
- IAM least privilege has not been fully audited.
- KMS key policy has not been fully audited.
- Replay and idempotency controls need deeper review.
- OpenSearch/Search Mode is not validated.
- Production deployment posture is not established.
- Incident response procedures are not established.
- Formal compliance controls are not established.

Security doctrine
-----------------

Ghost Ark must treat security as bounded evidence, not vibes.

Every security claim must answer:

- What was tested?
- Which principal was used?
- Which tenant was used?
- Which route was used?
- Which AWS resource was inspected?
- Which failure mode was tested?
- What remains untested?
- What must not be claimed?

Authentication backlog
----------------------

AUTH-001 - Confirm all core API methods require Cognito authorization

Status:

- Implemented as a CDK template regression test.

Evidence:

- tests/integration/api/template-auth.test.ts
- Validated result: every synthesized core API method uses Cognito user-pool authorization.

Remaining work:

- Ensure future API routes cannot silently bypass authorization.
- Add review checklist for any new API route.

AUTH-002 - Validate Cognito tenant claim extraction

Status:

- Partially validated.

Evidence:

- tests/integration/api/auth.test.ts

Remaining work:

- Add malformed claim tests.
- Add missing custom:tenant_slug tests.
- Add unexpected role formatting tests.
- Add tests for empty tenant slug rejection.

AUTH-003 - Developer header bypass review

Risk:

- Development headers can be useful for local testing but dangerous if accidentally enabled in production.

Current behavior:

- ALLOW_DEVELOPER_HEADERS is set to false for all synthesized API Lambda environments.
- Runtime auth does not read developer tenant headers.

Evidence:

- tests/integration/api/template-env.test.ts
- tests/security/tenantBoundary.test.ts

Remaining work:

- Keep local testing on signed test tokens or Lambda-authorizer fixtures, not client-declared identity headers.

Authorization backlog
---------------------

AUTHZ-001 - Cross-tenant receipt retrieval rejection

Required test:

- User authenticated as acme-lab attempts to retrieve beta-lab receipt.
- Expected result: forbidden or not found.
- The behavior must be explicit and documented.

AUTHZ-002 - Cross-tenant claim listing rejection

Required test:

- User authenticated as acme-lab attempts GET /tenants/beta-lab/claims.
- Expected result: forbidden or not found.

AUTHZ-003 - Route tenant/path tenant mismatch

Required test:

- Cognito custom:tenant_slug does not match path tenantSlug.
- Handler must reject the request.

AUTHZ-004 - Tenant slug validation

Required test:

- malformed tenant slugs are rejected.
- uppercase tenant slugs are rejected if schema requires lowercase.
- path traversal-like tenant strings are rejected.
- empty tenant slug is rejected.

Receipt security backlog
------------------------

RCT-001 - Receipt verification CLI

Required capability:

- Fetch receipt from DynamoDB or load receipt JSON.
- Validate receipt schema.
- Recompute canonical digest.
- Compare recomputed digest with signature.digestSha256.
- Verify signature using KMS Verify or public key verification.
- Check expected tenantSlug.
- Print PASS or FAIL with exact reason.

Why this matters:

- A receipt-control plane is incomplete until a consumer can independently verify receipts.

RCT-002 - Tamper detection tests

Required tests:

- payload tampering fails verification.
- digest tampering fails verification.
- signature tampering fails verification.
- algorithm mismatch fails verification.
- key mismatch fails verification.

RCT-003 - Receipt replay/idempotency review

Required review questions:

- Can the same logical evidence submission create duplicate receipts?
- Should duplicate submissions return the same receiptId?
- Should duplicate submissions create a new receipt with a lineage link?
- Is receiptId deterministic enough for replay detection?
- Are timestamps part of the signed payload?
- Is replay acceptable, rejected, or recorded?

RCT-004 - Receipt status lifecycle

Required statuses to consider:

- issued
- verified
- disputed
- superseded
- revoked

Design rule:

- Receipts preserve history.
- Claims may change interpretation.
- Evidence should not be silently erased.

KMS backlog
-----------

KMS-001 - Key policy audit

Required review:

- Who can administer the KMS key?
- Who can sign with the KMS key?
- Who can verify with the KMS key?
- Can Lambda sign but not administer the key?
- Are humans separated from runtime signing roles?
- Is key rotation or key replacement documented?
- Is public key export documented if offline verification is required?

KMS-002 - Signing scope audit

Required review:

- Only receipt payload digests should be signed.
- Arbitrary signing should not be exposed through public API routes.
- Signing Lambda should validate payload schema before signing.
- Signature algorithm must be explicit.

KMS-003 - Verification model decision

Options:

- KMS Verify
- offline public key verification
- both

Decision required:

- Choose default verifier behavior.
- Document tradeoffs.

DynamoDB backlog
----------------

DDB-001 - Table access pattern review

Required document:

- docs/architecture/DYNAMODB_ACCESS_PATTERNS.md

Required access patterns:

- get receipt by tenantSlug and receiptId
- list claims by tenantSlug
- attach receipt to claim
- list lineage events for tenant
- retrieve claim by claimId
- retrieve receipts for claim
- retrieve receipts by subject

DDB-002 - Tenant key enforcement review

Required review:

- All tenant-scoped records must include tenantSlug.
- All tenant-scoped queries must include tenantSlug.
- No handler should scan across tenants for normal user requests.
- Admin cross-tenant behavior must be separately designed.

DDB-003 - Data retention review

Required review:

- How long are receipts retained?
- How long are claims retained?
- How is revoked evidence handled?
- What is deleted versus marked revoked?
- What is exported versus retained?

S3 backlog
----------

S3-001 - Evidence object boundary review

Required review:

- Evidence object URIs must be tenant-scoped.
- Evidence object references must not imply evidence truth.
- Bucket public access blocks must remain enabled.
- Versioning should remain enabled for evidence buckets.
- Encryption posture must be documented.

S3-002 - Evidence ingestion validation

Required tests:

- reject non-tenant-scoped object URI
- reject malformed S3 URI
- reject object references outside configured buckets
- record evidence role and classification context

IAM backlog
-----------

IAM-001 - Least privilege review

Required review:

- Lambda roles should access only required tables.
- CreateReceiptHandler should sign but not administer KMS keys.
- GetReceiptHandler should not sign.
- ListClaimsHandler should not sign.
- SearchEvidenceHandler should not exist in Core Mode.
- CDK deployment role permissions should be reviewed separately from runtime permissions.

IAM-002 - Principal tag strategy review

Required review:

- Tenant operator roles should use tenant tags consistently.
- PrincipalTag condition syntax must remain correct in Terraform.
- Tenant slug tags must not be user-controlled without governance.

API Gateway backlog
-------------------

API-001 - Protected route regression test

Status:

- Implemented.

Evidence:

- tests/integration/api/template-auth.test.ts

API-002 - Explicit unauthorized behavior tests

Required tests:

- no token returns HTTP 401
- invalid token returns HTTP 401
- valid token with missing tenant claim returns HTTP 403 or controlled error
- tenant mismatch returns HTTP 403 or controlled error

API-003 - Request validation

Required review:

- malformed JSON returns 400
- oversized body rejected
- missing evidenceObjects rejected
- missing governanceContext rejected
- invalid subject kind rejected

Search Mode backlog
-------------------

SEARCH-001 - Search remains opt-in

Status:

- Implemented and tested for disabled mode.

Evidence:

- GHOST_ARK_ENABLE_SEARCH=false default behavior
- Search route absent when search is disabled
- OpenSearch/NAT/EIP excluded from Core Mode documentation

SEARCH-002 - Search enabled validation

Required future work:

- deploy Search Mode intentionally
- confirm OpenSearch domain status
- confirm /search route authorization
- index test evidence
- query tenant-filtered evidence
- verify tenant cannot search another tenant
- document teardown procedure

Observability backlog
---------------------

OBS-001 - CloudWatch log review

Required review:

- Logs must not include tokens.
- Logs must not include secrets.
- Logs must not include full credentials.
- Logs may include receiptId, tenantSlug, route, status, and requestId.
- Sensitive evidence contents should not be logged.

OBS-002 - Alarm validation

Required review:

- Lambda error alarm behavior
- receipt gap alarm behavior
- SNS notification behavior
- alarm false positive handling
- alarm runbook

Secrets and credential backlog
------------------------------

SEC-001 - GitHub token handling

Status:

- Token-based CloudShell pushes are being used manually.

Required behavior:

- Tokens must never be pasted into chat.
- Tokens must be short-lived.
- Tokens must be fine-grained.
- Tokens must only allow Contents read/write for the selected repository.
- Tokens must be revoked after push.

SEC-002 - AWS credential handling

Required behavior:

- Do not export long-lived AWS keys into CloudShell.
- Prefer AWS console session identity in CloudShell.
- Do not commit credentials.
- Do not paste credentials into documentation.

Production readiness backlog
-----------------------------

PROD-001 - Production stage hardening

Required before prod:

- ALLOW_DEVELOPER_HEADERS=false
- separate prod user pool
- separate prod tables
- separate prod KMS key
- separate prod buckets
- separate prod CloudWatch alarms
- stricter IAM boundaries
- explicit backup and retention policy
- explicit incident response runbook
- rollback procedure
- cost budget alarms
- security review signoff

PROD-002 - Deployment safety

Required before prod:

- cdk diff review
- rollback plan
- failure mode testing
- deployment approval process
- environment separation
- smoke test after deployment
- teardown or rollback instructions

Priority order
--------------

Next engineering priorities:

1. Wire the enforcement runtime around a Bedrock invocation path.
2. Add tenant-scoped policy storage and retrieval.
3. Add KMS-backed decision receipt signing and verification.
4. Add DynamoDB-backed privacy vault storage with delete/export flows.
5. Add retrieval tenant and taint filtering before prompt construction.
6. Add API request validation tests.
7. Add IAM least-privilege review notes.
8. Add Search Mode validation only when intentionally needed.

Current security verdict
------------------------

Ghost Ark has a validated dev-core security baseline for API authorizer attachment, tenant path checks, disabled developer-header tenant authority, receipt verification, and local enforcement-runtime primitives.

Ghost Ark does not yet have a complete security posture.

The correct claim is:

Ghost Ark dev core has Cognito-protected synthesized API methods, documented claim boundaries, documented validation evidence, documented cost mode boundaries, and local deterministic policy, memory, and decision-receipt tests.

The forbidden claim is:

Ghost Ark is secure, production-ready, compliant, or AI-safety-certified.
