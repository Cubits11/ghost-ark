Ghost Ark Tenant Boundary Live Validation - 2026-07-07
======================================================

Validation verdict
------------------

PASS.

The deployed Ghost Ark dev API rejected a Cognito acme-lab identity attempting to access the beta-lab claims path.

Validated deployment
--------------------

AWS account:

088586527731

AWS principal:

arn:aws:iam::088586527731:user/pranav-admin

Region:

us-east-1

API endpoint:

https://3jptat07m3.execute-api.us-east-1.amazonaws.com/dev/

User pool:

us-east-1_hsowGWwLd

User pool client:

7g6e6qis8g61rl5cavdt3tjl7g

Repository commit deployed:

5f659a9 fix: reject cross-tenant API path access

Search mode
-----------

Search mode was disabled during the deployment.

Observed stack list:

- GhostArk-dev-Api
- GhostArk-dev-Orchestration
- GhostArk-dev-Observatory

Search stack was not included in the deployment path.

CDK diff summary
----------------

The API stack diff showed only a ListClaimsHandler code asset change.

Observed changed resource:

- AWS::Lambda::Function ListClaimsHandler

Deployment result
-----------------

The API stack deployed successfully.

Stack:

GhostArk-dev-Api

Output endpoint:

https://3jptat07m3.execute-api.us-east-1.amazonaws.com/dev/

Validation checks
-----------------

Check 1 - unauthenticated claims request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Command behavior:

GET /tenants/acme-lab/claims without token.

Observed status:

401

Observed response:

{"message":"Unauthorized"}

Result:

PASS.

Meaning:

The route rejected unauthenticated access.

Check 2 - matching tenant claims request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Identity tenant:

acme-lab

Path tenant:

acme-lab

Endpoint:

GET /tenants/acme-lab/claims

Observed status:

200

Observed response:

{"claims":[]}

Result:

PASS.

Meaning:

A Cognito identity for acme-lab could access the matching acme-lab claims path.

Check 3 - cross-tenant claims request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Identity tenant:

acme-lab

Path tenant:

beta-lab

Endpoint:

GET /tenants/beta-lab/claims

Observed status:

403

Observed response:

{"error":{"code":"AUTHORIZATION_ERROR","message":"Cross-tenant access denied","context":{"principalTenant":"acme-lab","requestedTenant":"beta-lab"}}}

Result:

PASS.

Meaning:

A Cognito identity for acme-lab was rejected when attempting to access the beta-lab claims path.

Smoke user lifecycle
--------------------

A temporary Cognito smoke user was created for the validation.

The user was configured with:

- custom:tenant_slug = acme-lab
- email_verified = true

After validation, the smoke user was deleted.

No smoke password or token was recorded in this document.

Repository validation
---------------------

Before and after deployment, repository validation passed.

Observed test baseline after the fix:

- 11 test files passed
- 30 tests passed
- docs check passed

Security meaning
----------------

This validation closes the gap between repository security tests and deployed AWS behavior.

The repository test proved:

- get receipt rejects path tenant mismatch
- list claims rejects path tenant mismatch
- matching tenant paths still work

The live AWS test proved:

- deployed Cognito token for acme-lab works on acme-lab path
- deployed Cognito token for acme-lab is rejected on beta-lab path
- unauthenticated access is rejected

Current bounded claim
---------------------

Ghost Ark dev API currently rejects a Cognito acme-lab identity attempting to access the beta-lab claims path, while allowing the same identity to access the matching acme-lab claims path.

Expanded bounded claim
----------------------

Ghost Ark dev core currently has:

- Cognito-protected core API routes
- developer headers disabled in prod synthesis
- search disabled by default
- tenant path mismatch rejection for receipt retrieval and claim listing in tests
- live deployed tenant mismatch rejection for the claims route
- receipt issuance
- receipt persistence
- receipt retrieval
- receipt verification
- KMS signature verification
- tamper-aware verifier tests
- documented claim boundaries
- documented cost modes
- documented DynamoDB access patterns
- documented security backlog

Explicit non-claims
-------------------

This validation does not prove:

- complete tenant isolation
- all-route security
- production readiness
- compliance readiness
- AI safety
- evidence truth
- least-privilege IAM
- KMS policy correctness
- incident response readiness
- Search Mode behavior
- OpenSearch behavior
- all failure modes
- all future deployments

Known warning
-------------

CDK and AWS SDK emitted a Node version warning.

Observed environment:

- Node v20.20.2

Warning meaning:

- Future AWS SDK versions published after the first week of January 2027 will require Node >= 22.

Current impact:

- Not blocking for this validation.
- CDK deploy succeeded.
- Repository validation passed.
- Live API validation passed.

Future action:

- Upgrade CloudShell/local Node runtime to Node 22 when convenient.

Next hardening moves
--------------------

Recommended next moves:

1. Record a receipt verifier runbook.
2. Add API tenant-boundary documentation.
3. Add live receipt retrieval tenant mismatch validation.
4. Add IAM/KMS least-privilege review notes.
5. Add release checklist update with current validated claims.
6. Add production deployment non-claims and preflight checklist.
