# Ghost Ark v50

Ghost Ark v50 is an AWS-native evidence lake and receipt-control platform for governed ingestion, transform, cataloging, search, signing, lineage, and disclosure.

It is designed for teams that need more than logs in a bucket and less than a magical safety-certification story. Ghost Ark stores raw and curated evidence in S3, catalogs it through AWS-native metadata layers, enforces governed access, issues signed receipts, records receipt state in a ledger, and exposes query, search, replay, and review workflows for analysts, auditors, and platform operators.

## What Ghost Ark Is

- An evidence lake with raw and curated zones.
- A receipt system with canonical payloads and AWS KMS-backed asymmetric signatures.
- A lineage and replay framework for evidence-producing workflows.
- A governed query plane built on cataloged datasets.
- A multi-tenant control plane with namespaced IAM and policy templates.
- A product surface for claims, review, search, and exportable evidence packs.

## What Ghost Ark Is Not

- Not a proof that a model, dataset, system, or organization is safe.
- Not a substitute for statistical validity, red teaming, model evaluation, or governance review.
- Not a claim that cryptographic integrity equals empirical truth.
- Not a one-click compliance certificate.
- Not an excuse to collapse tenant, cohort, or account boundaries.

## Core Planes

- **Ingest:** S3 drops, SQS fan-in, Lambda handlers, DMS/CDC normalization.
- **Transform:** Glue Spark jobs and lightweight Lambda transforms.
- **Catalog and Govern:** Glue Data Catalog, Athena, Lake Formation grants, LF-Tags, row filters, and column controls.
- **Attest:** canonical hashes, KMS asymmetric signatures, DynamoDB receipt and lineage ledgers.
- **Present:** APIs, OpenSearch evidence search, observatory dashboards, and evidence-pack export.

## Repository Map

- `apps/` user-facing API handlers and console feature surfaces.
- `packages/` shared receipt schemas, policy compilers, lineage models, and runtime utilities.
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
5. Run the example S3 to catalog to receipt pipeline.
6. Query curated datasets in Athena.
7. Inspect the signed receipt in DynamoDB and through the API.

## Design Stance

Ghost Ark is a cryptographic tracking substrate, not a magical tool that automatically validates empirical truth claims. It prefers narrow claims, explicit boundaries, replayable workflows, tenant-scoped permissions, and auditable transformations. Every public claim should be traceable to evidence objects, transforms, governance policies, receipts, and ledger events.

## Security Defaults

- Tenant slugs are mandatory and must pass canonical validation.
- IAM policies use `${aws:PrincipalTag/slug}` scoping and explicit region deny statements.
- Service roles are centrally owned and passed only to intended AWS services.
- KMS signing uses asymmetric keys with `SIGN_VERIFY` usage.
- Raw, curated, receipt, and export paths are separated by tenant namespace.
- Lake Formation is the fine-grained disclosure layer; bespoke ACL logic is not the primary governance mechanism.

## Validation Lanes

- Unit tests for canonicalization, schemas, policy compilers, and signing helpers.
- Integration checks for handlers, OpenSearch templates, and Step Functions definitions.
- AWS-gated tests for dev-account receipt pipeline and tenant isolation.
- Policy simulation through `tools/policy-sim/simulate.sh`.
