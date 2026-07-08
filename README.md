# Ghost Ark v50

Ghost Ark v50 is an AWS-native reference implementation for bounded governance receipts and deterministic enforcement primitives around LLM applications.

The existing AWS slice stores raw and curated evidence in S3, catalogs it through AWS-native metadata layers, enforces governed access, issues signed evidence receipts, records receipt state in a ledger, and exposes query, search, replay, and review workflows. The enforcement-runtime slice adds deterministic policy evaluation, tenant-scoped policy loading, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory-write gates, redacted logging, and decision receipt emission for governed LLM paths.

Ghost Ark now includes a governed Bedrock invocation runtime spine with stronger local fail-closed, idempotency, retrieval-taint, vault-expiry, Bedrock-adapter, and AWS-validation evidence boundaries. AWS wiring exists for the invoke API route, DynamoDB policy and privacy-vault tables, decision receipt storage, KMS decision signing and verification support, Bedrock model allowlisting, scoped Bedrock IAM when an allowlist is supplied, a Secrets Manager HMAC digest secret, and operational alarms. Live AWS validation and server-side retrieval provider integration remain release blockers.

## What Ghost Ark Is

- An evidence lake with raw and curated zones.
- A receipt system with canonical payloads and AWS KMS-backed asymmetric signatures.
- A lineage and replay framework for evidence-producing workflows.
- A governed query plane built on cataloged datasets.
- A multi-tenant control plane with namespaced IAM and policy templates.
- A deterministic enforcement-runtime package for policy decisions, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory gates, and decision receipts.
- A product surface for claims, review, search, and exportable evidence packs.

## What Ghost Ark Is Not

- Not a proof that a model, dataset, system, or organization is safe.
- Not a substitute for statistical validity, red teaming, model evaluation, or governance review.
- Not a claim that cryptographic integrity equals empirical truth.
- Not a one-click compliance certificate.
- Not an excuse to collapse tenant, cohort, or account boundaries.
- Not clinical, therapeutic, emotional-safety, or legal-compliance software.
- Not proof that a model output is semantically correct.

## Core Planes

- **Ingest:** S3 drops, SQS fan-in, Lambda handlers, DMS/CDC normalization.
- **Transform:** Glue Spark jobs and lightweight Lambda transforms.
- **Catalog and Govern:** Glue Data Catalog, Athena, Lake Formation grants, LF-Tags, row filters, and column controls.
- **Attest:** canonical hashes, KMS asymmetric signatures, DynamoDB receipt and lineage ledgers.
- **Present:** APIs, OpenSearch evidence search, observatory dashboards, and evidence-pack export.

## Repository Map

- `apps/` user-facing API handlers and console feature surfaces.
- `packages/` shared receipt schemas, policy compilers, lineage models, enforcement-runtime primitives, and runtime utilities.
- `services/` ingest, transform, orchestration, governance, signing, search, and ledger implementations.
- `infra/` Terraform account bootstrap plus CDK application stacks.
- `schemas/` JSON Schema contracts for external validation.
- `tests/` unit, integration, AWS-gated, and policy simulation lanes.
- `docs/` architecture, operations, product, and compliance-facing documentation.

## Getting Started

1. Install dependencies with `npm ci`.
2. Validate local code with `npm run validate`.
3. Bootstrap a dev account from `infra/terraform/bootstrap`.
4. Deploy application services from `infra/cdk`.
5. Follow `docs/operations/runbooks/sandbox-validation.md` for the dev-account plan, deploy, alarm, API, and tenant-isolation checks.
6. Run the example S3 to catalog to receipt pipeline.
7. Query curated datasets in Athena.
8. Inspect the signed receipt in DynamoDB and through the API.

## Design Stance

Ghost Ark is a cryptographic tracking substrate, not a magical tool that automatically validates empirical truth claims. It prefers narrow claims, explicit boundaries, replayable workflows, tenant-scoped permissions, and auditable transformations. Every public claim should be traceable to evidence objects, transforms, governance policies, receipts, and ledger events.

## Security Defaults

- Tenant slugs are mandatory and must pass canonical validation.
- Terraform renders IAM policy variables as `${aws:PrincipalTag/slug}` using `$${...}` HCL escaping, and tenant sandbox policies keep explicit region deny statements.
- Bootstrap S3 buckets have versioning enabled for raw, curated, export, and Athena result zones.
- Receipt API routes use an API Gateway Cognito authorizer. Runtime handlers read tenant identity from `tenant_slug`, `custom:tenant_slug`, or Lambda-authorizer tenant context.
- Client-declared tenant, user, and session identifiers are rejected for receipt creation.
- General structured logs redact prompt, completion, memory, raw body, and credential-like fields by default.
- Service roles are centrally owned and passed only to intended AWS services.
- KMS signing uses asymmetric keys with `SIGN_VERIFY` usage.
- Governed invoke decision receipts can be verified locally for HMAC-dev signatures or with a KMS public-key verifier for `KMS_SIGN_RSASSA_PSS_SHA_256`.
- Raw, curated, receipt, and export paths are separated by tenant namespace.
- Governed invoke resolves tenant and user authority from JWT or authorizer context, rejects client-declared tenant/user/session authority, and fails closed on path/auth tenant mismatch.
- Governed invoke emits minimized decision receipts containing digests and decisions, not raw prompts, completions, or memory contents.
- AWS governed invoke mode requires a configured HMAC digest secret through Secrets Manager or explicit deployment-time injection; CDK does not place the secret value in plaintext environment variables.
- AWS governed invoke mode requires a Bedrock model allowlist. If no allowlist is configured, invocation fails closed before Bedrock.
- KAPPA memory is invocation-only, SESSION memory requires expiry, and RESTRICTED memory requires explicit consent.
- Lake Formation is the fine-grained disclosure layer; bespoke ACL logic is not the primary governance mechanism.
- OpenSearch access from API Lambda roles is scoped to the deployed domain ARN, and the domain security group only accepts HTTPS from the API search Lambda security group.
- Observatory Lambda-error and Ghost Ark custom receipt-gap alarms notify the observatory SNS topic.

## Validation Lanes

- Unit tests for canonicalization, schemas, policy compilers, and signing helpers.
- Unit tests for deterministic LLM policy decisions, conflict precedence, memory suppression, consent, TTL filtering, decision receipt verification, hash-chain checks, tenant override rejection, and log redaction.
- Unit and integration tests for governed invoke refusal, successful model invocation, post-model redaction, retrieval taint filtering, memory gates, receipt emission, and fail-closed receipt emission.
- Integration checks for handlers, OpenSearch templates, and Step Functions definitions.
- AWS-gated tests for dev-account receipt pipeline and tenant isolation with `RUN_AWS_TESTS=true`.
- Policy simulation through `tools/policy-sim/simulate.sh`.

## Governed Invoke

Local validation:

```bash
npm test -- tests/unit/enforcement-runtime/runtime tests/unit/enforcement-runtime/retrieval tests/unit/enforcement-runtime/receipts tests/integration/test_governedInvokeLifecycle.test.ts
```

CDK adds `POST /tenants/{tenantSlug}/invoke` with Cognito authorization. Deployed defaults are AWS-backed (`GHOST_ARK_MODEL_MODE=bedrock`, `GHOST_ARK_RECEIPT_SIGNER=kms`, `GHOST_ARK_POLICY_REPOSITORY=dynamodb`, `GHOST_ARK_VAULT=dynamodb`) and read private identifier digest material from `GHOST_ARK_RECEIPT_HMAC_SECRET_ARN`. The plaintext secret value is not set in CDK Lambda environment variables.

AWS validation candidate setup:

```bash
npx cdk synth -c bedrockModelAllowlist=anthropic.claude-3-5-sonnet-20240620-v1:0
npm run seed:governed-policy -- --table ghost-ark-dev-tenant-policies --tenant acme-lab
npm run smoke:governed-invoke -- --api "$API_URL" --token "$ID_TOKEN" --tenant acme-lab --model anthropic.claude-3-5-sonnet-20240620-v1:0 --json-report docs/validation/governed-invoke-dev.json
```

The AWS path is not production-ready after a smoke run. The smoke report is sanitized validation evidence only.
