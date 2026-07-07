Ghost Ark Demo Runbook - Core Receipt Flow
==========================================

Purpose
-------

This runbook describes a short, bounded demonstration of the Ghost Ark dev-core receipt flow.

The demo shows that Ghost Ark can issue and retrieve a signed, tenant-scoped receipt through AWS services.

The demo does not claim production readiness.
The demo does not claim compliance certification.
The demo does not claim AI safety.
The demo does not claim that evidence contents are true.
The demo does not claim complete tenant isolation.

Demo thesis
-----------

Ghost Ark is an evidence-control plane for bounded assurance claims.

The demo answers this question:

What exactly was claimed, under what tenant boundary, with what evidence reference, signed by what key, and retrievable through what authenticated route?

Validated architecture path
---------------------------

The core demo path is:

Cognito identity
-> API Gateway authorizer
-> Lambda handler
-> receipt payload construction
-> KMS signing
-> DynamoDB persistence
-> tenant-scoped API retrieval

Services involved
-----------------

Core mode uses:

- Amazon Cognito
- Amazon API Gateway
- AWS Lambda
- AWS KMS
- Amazon DynamoDB
- Amazon S3
- AWS CloudFormation
- AWS CDK
- Amazon CloudWatch

Search mode is intentionally disabled by default.

The demo should not require:

- OpenSearch
- NAT Gateway
- Elastic IP
- search-enabled VPC deployment

Preconditions
-------------

Before running the demo:

- AWS region is us-east-1.
- The dev API stack is deployed.
- GhostArk-dev-Api is CREATE_COMPLETE or UPDATE_COMPLETE.
- Search mode is disabled unless explicitly testing search.
- A Cognito smoke user exists or can be created.
- The smoke user has custom:tenant_slug set to acme-lab.
- The repository validates with npm run validate.

Known validated commit baseline
-------------------------------

The documented baseline is:

0034884 docs: record AWS dev core smoke validation
2dbe551 docs: define Ghost Ark claim boundaries

Earlier implementation milestone:

d2dc256 feat: support search-optional API deployment

Demo environment variables
--------------------------

Use these variables in CloudShell:

export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
export PAGER=cat

API_URL="https://3jptat07m3.execute-api.us-east-1.amazonaws.com/dev"
USER_POOL_ID="us-east-1_hsowGWwLd"
USER_POOL_CLIENT_ID="7g6e6qis8g61rl5cavdt3tjl7g"
TENANT_SLUG="acme-lab"

Step 1 - Validate repository
----------------------------

Command:

npm run validate

Expected result:

- TypeScript build passes.
- Unit and integration tests pass.
- Docs check passes.

Known validated result:

- 7 test files passed.
- 13 tests passed.
- docs check passed.

Demo explanation:

This proves only that the repository checks passed under the current environment. It does not prove production readiness or safety.

Step 2 - Confirm deployed API stack
-----------------------------------

Command:

aws cloudformation describe-stacks \
  --stack-name GhostArk-dev-Api \
  --query 'Stacks[0].{StackName:StackName,Status:StackStatus,Updated:LastUpdatedTime,Outputs:Outputs}' \
  --output json \
  --no-cli-pager

Expected result:

GhostArk-dev-Api is CREATE_COMPLETE or UPDATE_COMPLETE.

Demo explanation:

This proves the named dev stack exists and is deployed. It does not prove operational readiness.

Step 3 - Authenticate smoke user
--------------------------------

Use a Cognito user with custom:tenant_slug set to acme-lab.

Command pattern:

aws cognito-idp initiate-auth \
  --client-id "$USER_POOL_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$SMOKE_USERNAME",PASSWORD="$SMOKE_PASSWORD" \
  --query 'AuthenticationResult.IdToken' \
  --output text \
  --no-cli-pager > /tmp/ghost-ark-id-token.txt

Then:

ID_TOKEN="$(cat /tmp/ghost-ark-id-token.txt)"

Expected result:

A non-empty ID token is acquired.

Demo explanation:

This proves the request can be associated with a Cognito identity. Tenant identity is expected to come from custom:tenant_slug.

Security note:

Do not paste tokens, passwords, or GitHub PATs into chat, docs, commits, or terminal output.

Step 4 - Issue receipt
----------------------

Create a request body:

cat > /tmp/ghost-ark-receipt-body.json <<'JSON'
{
  "subject": {
    "kind": "dataset-version",
    "id": "smoke-dataset-v1",
    "uri": "s3://ghost-ark-dev-curated-088586527731-us-east-1/tenants/acme-lab/curated/smoke-dataset-v1.json",
    "metadata": {
      "purpose": "authenticated Ghost Ark API smoke test"
    }
  },
  "evidenceObjects": [
    "s3://ghost-ark-dev-raw-088586527731-us-east-1/tenants/acme-lab/raw/smoke-evidence.json"
  ],
  "lineageEventIds": [],
  "claimIds": [],
  "governanceContext": {
    "lakeFormationTags": {
      "tenant_slug": "acme-lab",
      "classification": "internal",
      "evidence_role": "smoke-test"
    },
    "columnRestrictions": [],
    "policyCompilerVersion": "50.0.0"
  },
  "transform": {
    "runId": "smoke-run-001",
    "jobName": "manual-api-smoke",
    "parameters": {
      "searchEnabled": false
    }
  }
}
JSON

Send request:

curl -sS \
  -X POST "${API_URL}/receipts" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary @/tmp/ghost-ark-receipt-body.json \
  -w "%{http_code}\n" \
  -o /tmp/ghost-ark-post-body.json

Expected result:

HTTP 201.

Demo explanation:

This proves an authenticated caller can request receipt issuance under the tested tenant boundary.

Step 5 - Inspect receipt signature fields
-----------------------------------------

Command:

cat /tmp/ghost-ark-post-body.json

Expected fields:

- payload.receiptId
- payload.schemaVersion
- payload.tenantSlug
- payload.subject
- payload.evidenceObjects
- payload.governanceContext
- signature.keyId
- signature.algorithm
- signature.messageType
- signature.digestSha256
- signature.signatureBase64
- signature.signedAt
- status
- createdAt
- updatedAt

Known validated signature fields:

- signature.keyId: alias/ghost-ark-dev-receipt-signing
- signature.algorithm: RSASSA_PSS_SHA_256
- signature.messageType: DIGEST

Demo explanation:

This proves a receipt record contains signing metadata. Full independent verification requires the receipt verifier tooling.

Step 6 - Extract receiptId
--------------------------

Command:

python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path("/tmp/ghost-ark-post-body.json").read_text())
receipt_id = data["payload"]["receiptId"]
Path("/tmp/ghost-ark-receipt-id.txt").write_text(receipt_id)
print(receipt_id)
PY

Then:

RECEIPT_ID="$(cat /tmp/ghost-ark-receipt-id.txt)"

Expected result:

A receipt id beginning with rct_.

Known validated receipt:

rct_ecb831ff47d696bf7b925afe692bcb241b101ad8041e665bcef17fdaf19a435d

Step 7 - Query DynamoDB persistence
-----------------------------------

Command:

aws dynamodb get-item \
  --table-name ghost-ark-dev-receipts \
  --key "{\"tenantSlug\":{\"S\":\"${TENANT_SLUG}\"},\"receiptId\":{\"S\":\"${RECEIPT_ID}\"}}" \
  --query 'Item.{tenantSlug:tenantSlug.S,receiptId:receiptId.S,status:status.S,createdAt:createdAt.S}' \
  --output json \
  --no-cli-pager

Expected result:

The receipt exists with status issued.

Demo explanation:

This proves persistence in the tested DynamoDB table. It does not prove the evidence itself is true.

Step 8 - Retrieve receipt through tenant-scoped API
---------------------------------------------------

Command:

curl -sS \
  -X GET "${API_URL}/tenants/${TENANT_SLUG}/receipts/${RECEIPT_ID}" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -w "%{http_code}\n" \
  -o /tmp/ghost-ark-get-body.json

Expected result:

HTTP 200.

Demo explanation:

This proves tenant-scoped retrieval works for the authenticated tenant and tested receipt.

Step 9 - Test claims route without auth
---------------------------------------

Command:

curl -sS \
  -X GET "${API_URL}/tenants/${TENANT_SLUG}/claims" \
  -w "%{http_code}\n" \
  -o /tmp/claims-noauth.json

Expected result:

HTTP 401.

Demo explanation:

This proves API Gateway rejects the protected claims route without a valid token.

Step 10 - Test claims route with auth
-------------------------------------

Command:

curl -sS \
  -X GET "${API_URL}/tenants/${TENANT_SLUG}/claims" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -w "%{http_code}\n" \
  -o /tmp/claims-auth.json

Expected result:

HTTP 200.

Known validated response:

{"claims":[]}

Demo explanation:

This proves the claims route is protected by Cognito authorization and receives valid tenant context for the tested user.

Step 11 - State explicit non-claims
-----------------------------------

Say this clearly during the demo:

This demo does not prove that the evidence is true.
This demo does not prove that the system is safe.
This demo does not prove compliance.
This demo does not prove full tenant isolation.
This demo does not prove production readiness.
This demo proves only the bounded dev-core receipt flow under the tested configuration.

Step 12 - Close with next work
------------------------------

The next engineering milestone is receipt verification.

A complete verifier should:

- fetch or load a receipt
- validate receipt schema
- recompute canonical digest
- compare digest with signature.digestSha256
- verify signature using KMS Verify or exported public key verification
- check expected tenantSlug
- print PASS or FAIL with exact reason

Demo close
----------

Use this final sentence:

Ghost Ark does not say "this system is safe." Ghost Ark says: "this is the exact claim boundary, evidence reference, tenant identity, digest, signature, storage record, and non-claim set available for later review."
