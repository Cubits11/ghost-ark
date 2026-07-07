Ghost Ark DynamoDB Access Patterns
==================================

Purpose
-------

This document defines the DynamoDB access-pattern boundary for Ghost Ark.

Ghost Ark stores receipts, claims, and lineage records as tenant-scoped assurance artifacts.

The purpose of this document is to prevent accidental data-model drift, cross-tenant ambiguity, table scans, and unsupported access claims.

This document does not claim that Ghost Ark has complete tenant isolation.
This document does not claim production readiness.
This document does not claim compliance readiness.
This document defines the intended access-pattern contract that future code and tests must satisfy.

Core principle
--------------

Every normal user-facing data access path must be tenant-scoped.

The tenant slug is not decorative metadata.

The tenant slug is part of the security boundary, query boundary, operational boundary, and evidence boundary.

Required rule:

No normal user-facing handler should retrieve tenant-scoped data without tenantSlug in the key condition.

Current DynamoDB tables
-----------------------

Current dev tables:

- ghost-ark-dev-receipts
- ghost-ark-dev-claims
- ghost-ark-dev-lineage

Logical models:

- ReceiptRecord
- ClaimEnvelope
- LineageEvent

Receipt table
-------------

Table purpose:

The receipt table stores signed receipt records.

Current primary access pattern:

Get one receipt by tenantSlug and receiptId.

Current key shape:

- partition key: tenantSlug
- sort key: receiptId

Current repository method:

ReceiptRepository.get(tenantSlug, receiptId)

Expected behavior:

- Query must include tenantSlug.
- Query must include receiptId.
- Missing item returns controlled NotFoundError.
- Returned item must validate through receipt schema.
- Returned record must include payload, signature, status, createdAt, and updatedAt.

Current write access pattern:

Put one receipt record.

Current repository method:

ReceiptRepository.put(record)

Expected behavior:

- Stored item must include tenantSlug from payload.tenantSlug.
- Stored item must include receiptId from payload.receiptId.
- Stored item must include digestSha256 from signature.digestSha256.
- Stored item must include payload and signature.
- Put must use a condition expression to prevent accidental overwrite.

Current list access pattern:

List receipts for one tenant.

Current repository method:

ReceiptRepository.listByTenant(tenantSlug, limit)

Expected behavior:

- Query must include tenantSlug.
- Query should not scan across tenants.
- Default limit should remain bounded.
- Returned records must validate through receipt schema.

Current status mutation pattern:

Mark receipt status.

Current repository method:

ReceiptRepository.markStatus(tenantSlug, receiptId, status, reason)

Expected behavior:

- Update must include tenantSlug and receiptId.
- Update must require item existence.
- Status mutation should preserve the receipt payload and signature.
- Status mutation should not rewrite signed evidence.
- Status reason should be recorded.
- updatedAt should change.

Receipt access-pattern contract
-------------------------------

Supported receipt patterns:

- get receipt by tenantSlug and receiptId
- list receipts by tenantSlug
- put receipt if not exists
- mark receipt status by tenantSlug and receiptId
- verify receipt after retrieval

Unsupported receipt patterns unless explicitly designed later:

- scan all receipts across tenants
- get receipt by receiptId alone
- list all receipts globally
- mutate signed payload after issuance
- mutate signature after issuance
- delete receipt as normal workflow
- infer evidence truth from receipt existence

Receipt invariants
------------------

A receipt record must satisfy:

- payload.tenantSlug matches item tenantSlug
- payload.receiptId matches item receiptId
- receiptId is canonical hash-derived identity
- signature.digestSha256 matches canonical payload digest
- status is lifecycle metadata, not proof of evidence truth
- payload and signature are immutable after issuance unless a new superseding artifact is created

Claim table
-----------

Table purpose:

The claim table stores governance claims linked to receipt ids.

Current primary access pattern:

Get one claim by tenantSlug and claimId.

Current key shape:

- partition key: tenantSlug
- sort key: claimId

Current repository method:

ClaimRepository.get(tenantSlug, claimId)

Expected behavior:

- Query must include tenantSlug.
- Query must include claimId.
- Missing item returns controlled NotFoundError.
- Returned item must validate through claim envelope schema.

Current write access pattern:

Put one claim envelope.

Current repository method:

ClaimRepository.put(claim)

Expected behavior:

- Put must validate claim envelope.
- Put must use a condition expression to prevent accidental overwrite.

Current list access pattern:

List claims for one tenant, optionally filtered by state.

Current repository method:

ClaimRepository.list(tenantSlug, state, limit)

Expected behavior:

- Query must include tenantSlug.
- Optional state filtering is allowed.
- Normal listing must not scan across tenants.
- Default limit should remain bounded.

Current attachment pattern:

Attach receipt to claim.

Current repository method:

ClaimRepository.attachReceipt(tenantSlug, claimId, receiptId)

Expected behavior:

- Update must include tenantSlug and claimId.
- Update must require claim existence.
- receiptId should be appended to receiptIds.
- updatedAt should change.

Claim access-pattern contract
-----------------------------

Supported claim patterns:

- get claim by tenantSlug and claimId
- list claims by tenantSlug
- list claims by tenantSlug and state
- put claim if not exists
- attach receipt to claim by tenantSlug and claimId

Unsupported claim patterns unless explicitly designed later:

- scan all claims across tenants
- get claim by claimId alone
- list all claims globally
- attach receipt without tenantSlug
- treat human review as evidence truth
- treat claim acceptance as safety certification
- mutate claim history without lineage

Claim invariants
----------------

A claim envelope must satisfy:

- tenantSlug must be present
- claimId must be canonical hash-derived identity
- receiptIds must reference receipts, not evidence truth
- state is governance state, not objective truth
- revoked claims must not silently transition back to active state
- updatedAt must change when claim state or receiptIds change

Lineage table
-------------

Table purpose:

The lineage table stores events connecting evidence inputs, receipt outputs, transformations, actors, and signing actions.

Current primary access pattern:

List lineage events for one tenant.

Current key shape:

- partition key: tenantSlug
- sort key: eventId

Current repository methods:

- LineageRepository.put(event)
- LineageRepository.listByTenant(tenantSlug, limit)

Expected behavior:

- Put must validate lineage event.
- Put must use a condition expression to prevent accidental overwrite.
- List must include tenantSlug.
- List must not scan across tenants.
- Returned events must validate through lineage schema.

Lineage access-pattern contract
-------------------------------

Supported lineage patterns:

- put lineage event if not exists
- list lineage events by tenantSlug

Unsupported lineage patterns unless explicitly designed later:

- scan all lineage events globally
- list lineage for all tenants
- mutate lineage history silently
- delete lineage as normal workflow
- use lineage existence as proof of evidence truth

Lineage invariants
------------------

A lineage event must satisfy:

- tenantSlug must be present
- eventId must be stable and schema-valid
- inputs should reference upstream evidence or records
- outputs should reference downstream records or receipts
- actor should be recorded when available
- signing events should include keyId and digest metadata when available
- lineage records explain provenance but do not prove truth

Tenant boundary doctrine
------------------------

The tenant boundary is enforced in multiple layers:

- Cognito identity carries tenant context.
- API path carries tenantSlug for tenant-scoped routes.
- Handler authorization should reject tenant mismatch.
- DynamoDB key access must include tenantSlug.
- Receipt payload includes tenantSlug.
- Claim envelope includes tenantSlug.
- Lineage event includes tenantSlug.
- Verification CLI can require expected tenantSlug.

Required future test doctrine:

Every user-facing tenant route should eventually have a negative test:

- valid tenant can access own record
- valid tenant cannot access another tenant path
- missing tenant identity fails
- malformed tenant slug fails
- path tenant and identity tenant mismatch fails

No-scan rule
------------

Normal user-facing request paths must not scan tenant-scoped tables.

Allowed:

- GetCommand with tenantSlug and sort key
- QueryCommand with tenantSlug key condition

Not allowed for normal user-facing paths:

- ScanCommand across receipt table
- ScanCommand across claim table
- ScanCommand across lineage table
- Query without tenantSlug for tenant-scoped data
- global listing without explicit admin design

Admin exception doctrine
------------------------

Cross-tenant admin behavior is not currently part of the validated dev-core claim.

If admin behavior is added later, it must have:

- separate admin role
- explicit route namespace
- explicit authorization model
- explicit audit event
- explicit rate limits or pagination
- explicit non-claims
- explicit tests proving normal users cannot use admin paths

Data lifecycle
--------------

Receipts:

- issued
- disputed
- superseded
- revoked

Claims:

- draft
- under-review
- accepted
- disputed
- revoked
- superseded

Lineage:

- append-only by default

Deletion doctrine:

Normal deletion should not be the default assurance behavior.

Preferred patterns:

- mark revoked
- mark superseded
- create lineage event
- preserve original signed payload
- preserve original signature
- record reason

Hard deletion may be needed for legal, privacy, or operational reasons, but it must be separately designed.

Verification relationship
-------------------------

DynamoDB stores receipt records.

The verifier does not trust DynamoDB merely because a record exists.

The verifier checks:

- schema
- expected tenant
- canonical receiptId
- canonical digest
- message type
- algorithm
- KMS signature validity

This matters because storage is not proof.

Storage is only the location from which a record is retrieved.

Verification is the process that challenges the record.

Required future tests
---------------------

High-priority tests:

1. Cross-tenant receipt retrieval rejection.
2. Cross-tenant claim listing rejection.
3. Path tenant versus Cognito tenant mismatch rejection.
4. ReceiptRepository rejects overwrite.
5. ClaimRepository rejects overwrite.
6. LineageRepository rejects overwrite.
7. List methods use tenantSlug key condition.
8. Normal API handlers do not scan tenant tables.
9. Receipt status update preserves payload and signature.
10. Claim receipt attachment requires existing claim.

Recommended future documentation
--------------------------------

Add these documents later:

- docs/architecture/API_TENANT_BOUNDARY.md
- docs/architecture/KMS_SIGNING_MODEL.md
- docs/architecture/CLAIM_LIFECYCLE.md
- docs/architecture/LINEAGE_MODEL.md
- docs/security/IAM_LEAST_PRIVILEGE_REVIEW.md
- docs/runbooks/RECEIPT_VERIFIER.md

Current bounded claim
---------------------

Ghost Ark dev core currently has tenant-scoped repository methods for receipts, claims, and lineage, and a verifier that can validate a retrieved receipt against schema, canonical digest, canonical receipt id, expected tenant, signing metadata, and KMS signature validity.

Forbidden claim
---------------

This document does not prove complete tenant isolation, least privilege, compliance readiness, production readiness, AI safety, or evidence truth.
