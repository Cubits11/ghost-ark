Ghost Ark Receipt Verifier Live Validation - 2026-07-07
=======================================================

Validation verdict
------------------

PASS.

A live deployed Ghost Ark dev receipt was fetched from DynamoDB and verified through the receipt verification CLI.

Validated command
-----------------

npm run receipt:verify -- \
  --tenant acme-lab \
  --receipt rct_ecb831ff47d696bf7b925afe692bcb241b101ad8041e665bcef17fdaf19a435d \
  --table ghost-ark-dev-receipts

Validated receipt
-----------------

receiptId:

rct_ecb831ff47d696bf7b925afe692bcb241b101ad8041e665bcef17fdaf19a435d

tenantSlug:

acme-lab

Validated checks
----------------

The verifier reported:

- PASS schema
- PASS tenant
- PASS receiptId
- PASS digest
- PASS messageType
- PASS algorithm
- PASS signature
- VERDICT: PASS

Meaning of the checks
---------------------

schema:

The receipt record matched the Ghost Ark receipt schema.

tenant:

The receipt tenantSlug matched the expected tenant acme-lab.

receiptId:

The receiptId matched the canonical payload hash.

digest:

The signature digestSha256 matched the recomputed canonical payload digest.

messageType:

The signature messageType was DIGEST.

algorithm:

The signing algorithm was RSASSA_PSS_SHA_256.

signature:

AWS KMS Verify returned a valid signature result.

Repository validation
---------------------

The repository validation also passed.

Observed test baseline:

- 10 test files passed
- 21 tests passed
- docs check passed

Current validated capability
----------------------------

Ghost Ark dev core can:

- issue a receipt
- sign the canonical receipt payload through KMS
- persist the receipt record in DynamoDB
- retrieve the receipt record
- validate the receipt schema
- recompute the canonical receiptId
- recompute the canonical digest
- compare the digest against the signed digest
- verify the signature through AWS KMS
- report a bounded PASS or FAIL verdict

Security value
--------------

This moves Ghost Ark from a receipt issuer to a receipt verifier.

A signed receipt is no longer merely a stored log.

A signed receipt is now challengeable by a verifier that checks schema, tenant expectation, canonical identity, canonical digest, signing algorithm, message type, and KMS signature validity.

Explicit non-claims
-------------------

This validation does not prove:

- evidence truth
- AI safety
- compliance readiness
- production readiness
- deployment safety
- tenant isolation across all routes
- all IAM policies are least privilege
- all failure modes are handled
- all future receipts will verify
- all Search Mode behavior is valid
- OpenSearch behavior
- incident response readiness

The correct bounded claim is:

Ghost Ark dev core successfully verified one live tenant-scoped KMS-signed receipt against schema, canonical receiptId, canonical digest, expected tenant, signing metadata, and AWS KMS signature verification.

The forbidden claim is:

Ghost Ark is secure, compliant, production-ready, AI-safety-certified, or proof that the underlying evidence is true.

Known warning
-------------

The verifier run emitted a Node version warning from the AWS SDK for JavaScript v3.

Observed environment:

- Node v20.20.2

Warning meaning:

- Future AWS SDK versions published after the first week of January 2027 will require Node >= 22.

Current impact:

- Not blocking for this validation.
- Repository tests passed.
- Live KMS verification passed.

Future action:

- Upgrade local or CloudShell Node runtime to Node 22 when convenient.
- Keep Lambda runtime and local development runtime aligned over time.

Next hardening moves
--------------------

Recommended next moves:

1. Add tamper-fixture tests for changed payload fields.
2. Add cross-tenant negative API tests.
3. Add receipt verifier documentation/runbook.
4. Add DynamoDB access-pattern documentation.
5. Add IAM/KMS least-privilege review.
6. Add production developer-header and route authorization checks to release checklist.

