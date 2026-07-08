AWS Dev Core Smoke Validation - 2026-07-07
==========================================

Status
------

PASS for the bounded Ghost Ark dev-core smoke test.

This document records a development-environment validation of the Ghost Ark receipt-control plane.

This is not a production readiness claim.
This is not a compliance certification.
This is not a tenant-isolation proof.
This is not an AI safety certification.

Scope
-----

Validated in AWS:

- Stage: dev
- Region: us-east-1
- API stack: GhostArk-dev-Api
- Commit: d2dc256
- Search plane: disabled by default

Validated behaviors
-------------------

- Cognito-authenticated API access works.
- Cognito tenant identity is propagated through custom:tenant_slug.
- POST /receipts returns HTTP 201.
- Receipt payloads are signed using the configured KMS signing key.
- Receipt records are persisted in DynamoDB.
- Tenant-scoped receipt retrieval returns HTTP 200.
- GET /tenants/{tenantSlug}/claims without a token returns HTTP 401.
- GET /tenants/{tenantSlug}/claims with a valid token returns HTTP 200.
- Search is optional and disabled by default for the core deployment.

Repository validation
---------------------

npm run validate passed:

- 7 test files passed
- 13 tests passed
- docs check passed

CloudFormation evidence
-----------------------

GhostArk-dev-Api reached UPDATE_COMPLETE.

API endpoint:

https://3jptat07m3.execute-api.us-east-1.amazonaws.com/dev/

Receipt issuance evidence
-------------------------

POST /receipts returned HTTP 201.

Issued receipt:

rct_ecb831ff47d696bf7b925afe692bcb241b101ad8041e665bcef17fdaf19a435d

The receipt included:

- schemaVersion: ghost-ark.receipt.v1
- tenantSlug: acme-lab
- status: issued
- signature.algorithm: RSASSA_PSS_SHA_256
- signature.messageType: DIGEST
- signature.keyId: alias/ghost-ark-dev-receipt-signing

Historical note: this July 7, 2026 smoke output predates immutable-key enforcement. Current receipt signers and verifiers reject mutable KMS aliases and require an immutable key ARN or key UUID.

DynamoDB persistence evidence
-----------------------------

A DynamoDB lookup returned:

tenantSlug: acme-lab
receiptId: rct_ecb831ff47d696bf7b925afe692bcb241b101ad8041e665bcef17fdaf19a435d
status: issued
createdAt: 2026-07-06T23:35:08.691Z

Receipt retrieval evidence
--------------------------

GET /tenants/acme-lab/receipts/{receiptId} returned HTTP 200.

Claims authorization hardening
------------------------------

Before the fix, the /claims route reached Lambda without Cognito authorizer context and returned an internal authorization error.

After the fix:

Unauthenticated request:

GET /tenants/acme-lab/claims
HTTP 401

Authenticated request:

GET /tenants/acme-lab/claims
HTTP 200
response body: {"claims":[]}

Source change
-------------

Commit:

d2dc256 feat: support search-optional API deployment

Summary:

- Made SearchStack opt-in through GHOST_ARK_ENABLE_SEARCH / CDK context.
- Allowed ApiStack to deploy without OpenSearch endpoint/domain.
- Omitted SearchEvidenceHandler and /search route when search is disabled.
- Preserved search-enabled mode for future validation.
- Protected /claims route with Cognito authorizer.

Explicit non-claims
-------------------

This validation does not prove:

- Production readiness.
- Compliance readiness.
- AI safety.
- Correctness of evidence contents.
- Correctness of downstream claims.
- Complete tenant isolation.
- Full IAM least privilege.
- Full replay resistance.
- Full incident response readiness.
- Full OpenSearch/search-plane behavior.
- Human review quality.
- Deployment safety outside the tested dev boundary.

Next required work
------------------

- Add receipt verification tooling.
- Add claim lifecycle validation.
- Add replay/idempotency tests.
- Add negative tenant-access tests.
- Add least-privilege IAM review.
- Add cost guardrail documentation.
- Add CI/CD deployment documentation.
- Validate search-enabled mode separately.
