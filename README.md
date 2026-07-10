# Ghost Ark v50

Ghost Ark v50 is an AWS-native reference implementation for bounded governance receipts and deterministic enforcement primitives around LLM applications.

Cryptographic receipts, not safety claims: Ghost Ark verifies what was recorded, signed, and bounded by policy. It does not prove that an AI output is true, safe, ethical, compliant, or production-ready.

## Claim Discipline / Evidence Status

Ghost Ark is an AWS-runtime-validation candidate and certification-supporting evidence prototype. It is not certified, not production-hardened, and not a guarantee of AI safety.

Every public claim should map to local evidence, live AWS evidence, or an explicit limitation.

Governance references:

- [Claim/Evidence Matrix](docs/governance/claim-evidence-matrix.md)
- [Risk Register](docs/governance/risk-register.md)
- [External Reviewer Guide](docs/governance/external-reviewer-guide.md)
- [Claims Boundary](docs/release/CLAIMS_BOUNDARY.md)
- [Non-Claims](docs/compliance/non-claims.md)

## Spine Checklist

This checklist tracks evidence maturity, not personal goals or certification status.

| Item | Status | Spine | Evidence status |
|---|---:|---|---|
| Claim/evidence matrix | In progress | Spine A | Local documentation |
| Non-claim scanner | In progress | Spine A | Local enforcement |
| Receipt reproducibility harness | Complete | Spine B | Local tests and fixtures |
| Malicious receipt corpus | Complete | Spine B | Local negative tests |
| Evidence bundle schema, sanitizer, and local gate | Complete | Spine C local | L2 schema plus L3 local validator tests; synthetic fixture only |
| Live AWS evidence bundles | Not complete | Spine C | Requires bounded live AWS window |
| Key lifecycle and rotation protocol | Not complete | Spine D | Requires design and AWS validation |
| Guardrail observation schema | Not complete | Spine E | Requires schema and examples |
| CC-Framework correlation analysis | Not complete | Spine F | Requires integration evidence |
| Human review workflow | Not complete | Spine H | Requires workflow and evidence trail |
| Incident/failure reporting workflow | Not complete | Spine H | Requires workflow and examples |
| Risk register | In progress | Spine A | Local documentation |
| Control mapping to NIST AI RMF / ISO IEC 42001 | Not complete | Compliance spine | Requires mapping and review |
| External reviewer instructions | In progress | Spine A | Local documentation |
| Repeatable deployment evidence | Not complete | Spine C | Requires deploy, smoke, evidence, destroy |
| Independent verifier implementation | Partial | Spine B | Local verifier exists; independence boundary needs review |

A completed item means the repository contains evidence for that narrow item. It does not mean Ghost Ark is certified, production-hardened, or safe for unsupervised deployment.

## Verify A Receipt In 60 Seconds

Ghost-Ark’s narrowest useful demo is local receipt verification: given a sample receipt, a public key, and an expected tenant, the verifier checks canonical receipt identity, canonical payload digest, tenant expectation, and RSA-PSS signature validity.

```bash
npm ci
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

Tampering with the receipt payload, tenant, digest, algorithm, or signature changes the verdict to FAIL. This verifier checks canonical receipt identity, canonical payload digest, tenant expectation, and RSA-PSS signature validity against the supplied public key.

## Current Architecture Boundary

The existing AWS slice stores raw and curated evidence in S3, catalogs it through AWS-native metadata layers, enforces governed access, issues signed evidence receipts, records receipt state in a ledger, and exposes query, search, replay, and review workflows.

The enforcement-runtime slice adds deterministic policy evaluation, tenant-scoped policy loading, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory-write gates, redacted logging, and decision receipt emission for governed LLM paths.

Ghost Ark includes a governed Bedrock invocation runtime spine with local fail-closed, idempotency, retrieval-taint, vault-expiry, Bedrock-adapter, and AWS-validation evidence boundaries.

AWS wiring exists for the invoke API route, DynamoDB policy and privacy-vault tables, decision receipt storage, KMS decision signing and verification support, Bedrock model allowlisting, scoped Bedrock IAM when an allowlist is supplied, a Secrets Manager HMAC digest secret, and operational alarms.

Live AWS validation, repeatable evidence bundles, and server-side retrieval provider integration remain release blockers.

## What Ghost Ark Is

* An evidence lake with raw and curated zones.
* A receipt system with canonical payloads and AWS KMS-backed asymmetric signatures.
* A lineage and replay framework for evidence-producing workflows.
* A governed query plane built on cataloged datasets.
* A multi-tenant control plane with namespaced IAM and policy templates.
* A deterministic enforcement-runtime package for policy decisions, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory gates, and decision receipts.
* A product surface for claims, review, search, and exportable evidence packs.
* A local evidence artifact for receipt verification, claim discipline, and reviewer inspection.
* A candidate for bounded live AWS validation windows.

## What Ghost Ark Is Not

* Not a proof that a model, dataset, system, or organization is safe.
* Not a substitute for statistical validity, red teaming, model evaluation, or governance review.
* Not a claim that cryptographic integrity equals empirical truth.
* Not a one-click compliance certificate.
* Not an excuse to collapse tenant, cohort, or account boundaries.
* Not clinical, therapeutic, emotional-safety, or legal-compliance software.
* Not proof that a model output is semantically correct.
* Not production enclave security.
* Not production zero-knowledge privacy.
* Not full AWS IAM formal verification.
* Not deployment-safety certification.
* Not evidence that live AWS tenant isolation has passed unless a bounded live evidence bundle is present.
* Not evidence that KMS provenance has passed unless live AWS signing and verification evidence is present.
* Not a reason to leave dev infrastructure running when evidence collection is complete.

Phase 5/6/7 Experimental Verification Layers

## Ghost-Ark includes experimental verification layers for:

* runtime attestation binding
* receipt proof statement verification
* bounded tenant-policy counterexample search

These layers are designed to fail closed and expose verifier boundaries. They do not constitute deployment-safety certification, full AWS IAM formal verification, production enclave security, or production zero-knowledge privacy.

A PASS verdict means internal consistency under Ghost-Ark verifier rules for the supplied artifacts. It is not a safety certification, compliance certification, or proof of deployment correctness.

## Core Planes

* Ingest: S3 drops, SQS fan-in, Lambda handlers, DMS/CDC normalization.
* Transform: Glue Spark jobs and lightweight Lambda transforms.
* Catalog and Govern: Glue Data Catalog, Athena, Lake Formation grants, LF-Tags, row filters, and column controls.
* Attest: canonical hashes, KMS asymmetric signatures, DynamoDB receipt and lineage ledgers.
* Present: APIs, OpenSearch evidence search, observatory dashboards, and evidence-pack export.

## Repository Map

* apps/ user-facing API handlers and console feature surfaces.
* packages/ shared receipt schemas, policy compilers, lineage models, enforcement-runtime primitives, and runtime utilities.
* services/ ingest, transform, orchestration, governance, signing, search, and ledger implementations.
* infra/ Terraform account bootstrap plus CDK application stacks.
* schemas/ JSON Schema contracts for external validation.
* tests/ unit, integration, AWS-gated, and policy simulation lanes.
* docs/ architecture, operations, product, compliance, research, and governance documentation.
* tools/ local verifiers, smoke scripts, governance scanners, and evidence utilities.

## Local-Only Validation

Use this mode for zero-cost local research and reviewer checks.

npm ci
npm run lint
npm run validate:claims
npm test
npm run spine:a

Local validation can check schemas, canonicalization, fixtures, receipt verification, policy logic, scanner discipline, and unit/integration behavior. It cannot prove live AWS behavior.

AWS Synth Validation

Use this mode to check generated infrastructure templates without deployment.
npx cdk synth
npm test

CDK synthesis does not create live infrastructure and does not prove runtime behavior. It is useful for template review, IAM shape inspection, and pre-deployment validation.

## Bounded Live AWS Evidence Window

Use this mode only when intentionally collecting live AWS evidence.

A live evidence window should follow this lifecycle:

1. Check current cost and existing resources.
2. Deploy only the required dev stacks.
3. Run one focused smoke validation.
4. Capture sanitized evidence.
5. Verify receipts.
6. Export the report.
7. Destroy the dev stacks.
8. Confirm cleanup.

Local Spine C preparation is available without AWS credentials:

```bash
npm run spine:c:local
```

This validates an explicitly synthetic, non-live fixture and synthesizes Core Mode infrastructure without deployment. See the dedicated [preflight](docs/operations/runbooks/live-aws-evidence-preflight.md), [evidence-window](docs/operations/runbooks/live-aws-evidence-window.md), and [cleanup](docs/operations/runbooks/live-aws-evidence-cleanup.md) runbooks.

No preserved complete live bundle is added by the local gate. A future live validation must stay within its approved scope, preserve sanitized artifact bindings, destroy the scoped development stacks, and record any retained or residual resources honestly.

Getting Started

1. Run the local offline verifier.
2. Validate local code with npm run validate.
3. Review the claim boundary documents.
4. Inspect the governance checklist.
5. Bootstrap a dev account from infra/terraform/bootstrap only when live AWS work is required.
6. Deploy application services from infra/cdk only during a bounded evidence window.
7. Follow docs/operations/runbooks/sandbox-validation.md for the dev-account plan, deploy, alarm, API, and tenant-isolation checks.
8. Run the example S3 to catalog to receipt pipeline only when AWS evidence is required.
9. Query curated datasets in Athena only during live validation.
10. Inspect the signed receipt in DynamoDB and through the API only during live validation.

## Design Stance

Ghost Ark is a cryptographic tracking substrate, not a magical tool that automatically validates empirical truth claims. It prefers narrow claims, explicit boundaries, replayable workflows, tenant-scoped permissions, and auditable transformations.

Every public claim should be traceable to evidence objects, transforms, governance policies, receipts, verifier behavior, tests, and ledger events.

If a claim cannot be traced to evidence, it should be downgraded, marked as future work, or removed.

## Security Defaults

* Tenant slugs are mandatory and must pass canonical validation.
* Terraform renders IAM policy variables as ${aws:PrincipalTag/slug} using $${...} HCL escaping, and tenant sandbox policies keep explicit region deny statements.
* Bootstrap S3 buckets have versioning enabled for raw, curated, export, and Athena result zones.
* Receipt API routes use an API Gateway Cognito authorizer.
* Runtime handlers read tenant identity from tenant_slug, custom:tenant_slug, or Lambda-authorizer tenant context.
* Client-declared tenant, user, and session identifiers are rejected for receipt creation.
* General structured logs redact prompt, completion, memory, raw body, and credential-like fields by default.
* Service roles are centrally owned and passed only to intended AWS services.
* The default CDK stack creates an asymmetric KMS signing key with SIGN_VERIFY usage and grants signing permissions against the key ARN.
* Receipt API handlers receive table grants scoped to their repository behavior.
* Receipt creation can PutItem.
* Receipt reads can GetItem.
* Claim attachment keeps UpdateItem.
* Lineage writes remain append-only.
* Governed invoke decision receipts can be verified locally for HMAC-dev signatures or with a KMS public-key verifier for KMS_SIGN_RSASSA_PSS_SHA_256.
* Raw, curated, receipt, and export paths are separated by tenant namespace.
* Governed invoke resolves tenant and user authority from JWT or authorizer context.
* Governed invoke rejects client-declared tenant, user, and session authority.
* Governed invoke fails closed on path/auth tenant mismatch.
* Governed invoke emits minimized decision receipts containing digests and decisions, not raw prompts, completions, or memory contents.
* AWS governed invoke mode requires a configured HMAC digest secret through Secrets Manager or explicit deployment-time injection.
* CDK does not place the secret value in plaintext environment variables.
* AWS governed invoke mode requires a Bedrock model allowlist.
* If no allowlist is configured, invocation fails closed before Bedrock.
* KAPPA memory is invocation-only.
* SESSION memory requires expiry.
* RESTRICTED memory requires explicit consent.
* Lake Formation is the fine-grained disclosure layer.
* Bespoke ACL logic is not the primary governance mechanism.
* OpenSearch access from API Lambda roles is scoped to the deployed domain ARN.
* The OpenSearch domain security group only accepts HTTPS from the API search Lambda security group.
* Observatory Lambda-error and Ghost Ark custom receipt-gap alarms notify the observatory SNS topic.

## Validation Lanes

* Unit tests for canonicalization, schemas, policy compilers, and signing helpers.
* Unit tests for runtime attestation binding, receipt proof statements, and bounded policy counterexample search.
* Unit tests for deterministic LLM policy decisions, conflict precedence, memory suppression, consent, TTL filtering, decision receipt verification, hash-chain checks, tenant override rejection, and log redaction.
* Unit and integration tests for governed invoke refusal, successful model invocation, post-model redaction, retrieval taint filtering, memory gates, receipt emission, and fail-closed receipt emission.
* Integration checks for handlers, OpenSearch templates, and Step Functions definitions.
* AWS-gated tests for dev-account receipt pipeline and tenant isolation with RUN_AWS_TESTS=true.
* Policy simulation through tools/policy-sim/simulate.sh.
* Claim discipline through npm run validate:claims.

## Governed Invoke

Local validation: npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/integration/test_governedInvokeLifecycle.test.ts

CDK adds POST /tenants/{tenantSlug}/invoke with Cognito authorization.

Deployed defaults are AWS-backed:

* GHOST_ARK_MODEL_MODE=bedrock
* GHOST_ARK_RECEIPT_SIGNER=kms
* GHOST_ARK_POLICY_REPOSITORY=dynamodb
* GHOST_ARK_VAULT=dynamodb

The runtime reads private identifier digest material from GHOST_ARK_RECEIPT_HMAC_SECRET_ARN. The plaintext secret value is not set in CDK Lambda environment variables.

AWS validation candidate setup:

npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
npm run seed:governed-policy -- --table ghost-ark-dev-tenant-policies --tenant acme-lab
npm run smoke:governed-invoke -- \
  --api "$API_URL" \
  --token "$ID_TOKEN" \
  --tenant acme-lab \
  --model anthropic.claude-3-5-sonnet-20240620-v1:0 \
  --json-report evidence/live-aws-validation/dev/governed-invoke-dev.json

  The AWS path is not production-ready after a smoke run. The smoke report is sanitized validation evidence only.

Reviewer Interpretation

A reviewer should accept narrow evidence claims only when the repo points to concrete artifacts, commands, fixtures, tests, or live evidence bundles.

A reviewer should reject broad claims that imply:

- model behavior has been proven safe
- alignment has been established
- semantic truth has been established
- deployment correctness has been proven
- compliance certification has been achieved
- production readiness has been achieved
- residual risk has been eliminated
- complete security has been achieved
- live AWS validation exists without a preserved live AWS evidence bundle

Passing local tests means local artifacts behave as expected under the implemented verifier rules. It does not prove live AWS behavior, production security, regulatory compliance, or AI safety.
