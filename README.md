# Ghost-Ark: A Transactional Control Plane for Untrusted AI Agents

[![Artifact Evaluation: Functional](https://img.shields.io/badge/Artifact-Functional-green)](#)

Agentic LLM frameworks rely on probabilistic guardrails to evaluate *content*. **Ghost-Ark** is a strict enforcement runtime that isolates, validates, and cryptographically receipts *state mutations*.

> **Ghost-Ark verifies what was recorded, signed, and bounded by policy. It explicitly does _not_ prove that an AI output is true, aligned, compliant, or safe.**

---

# Verify a Receipt in 60 Seconds

Ghost-Ark's narrowest useful demo is local receipt verification. Given a sample receipt, a public key, and an expected tenant, the verifier checks:

- Canonical receipt identity
- Canonical payload digest
- Tenant expectation
- RSA-PSS signature validity

```bash
npm ci

npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

Tampering with the receipt payload, tenant, digest, algorithm, or signature changes the verdict to **FAIL**.

This verifier executes entirely locally against the supplied public key.

---

# Architecture

```mermaid
graph TD

    A[Untrusted LLM Agent]
        -->|Speculative Intent|
        B(Ghost Replica / Execution Buffer)

    B --> C{Three-Gate Validation}

    C -->|1. Ledger Gate| D[Nonce Check]
    C -->|2. OCC Gate| E[Read-Set Projection Check]
    C -->|3. Semantic Gate| F[Fréchet Drift Bounds]

    D -->|All Pass| G[VerifyAndBind: Commit to AWS]
    E -->|All Pass| G
    F -->|All Pass| G

    D -->|Any Fail| H[SpeculativeCollapse: Discard & Alert]
    E -->|Any Fail| H
    F -->|Any Fail| H

    G --> I[Emit Canonical JSON Receipt]
    H --> I
```

---

## Current Architecture Boundary

The enforcement-runtime slice adds:

- Deterministic policy evaluation
- Tenant-scoped policy loading
- Tenant- and taint-filtered retrieval context
- Bedrock invocation adapters
- Memory-write gates
- Redacted logging
- Decision receipt emission for governed LLM paths

The AWS slice:

- Stores raw and curated evidence in S3
- Enforces governed access via DynamoDB and Lake Formation
- Issues KMS-signed evidence receipts

---

# What Ghost-Ark Is (and Is Not)

## What Ghost-Ark Is

- An evidence lake with raw and curated zones.
- A receipt system with canonical payloads and AWS KMS-backed asymmetric signatures.
- A lineage and replay framework for evidence-producing workflows.
- A governed query plane built on cataloged datasets.
- A multi-tenant control plane with namespaced IAM and policy templates.
- A deterministic enforcement-runtime package for:
  - policy decisions
  - tenant and taint-filtered retrieval context
  - Bedrock invocation adapters
  - memory gates
  - decision receipts
- A local evidence artifact for receipt verification, claim discipline, and reviewer inspection.

---

## What Ghost-Ark Is **Not**

- Not a proof that a model, dataset, system, or organization is safe.
- Not a substitute for statistical validity, red teaming, model evaluation, or governance review.
- Not a claim that cryptographic integrity equals empirical truth.
- Not a one-click compliance certificate.
- Not proof that a model output is semantically correct.
- Not production enclave security or zero-knowledge privacy.
- Not evidence that live AWS tenant isolation has passed unless a bounded live evidence bundle is present.

---

# Claim Discipline & Reviewer Interpretation

Ghost-Ark is an AWS-runtime-validation candidate and bounded governance-evidence prototype.

It is:

- **not certified**
- **not production-hardened**
- **not a guarantee of AI safety**

Every public claim must map to:

1. Local evidence
2. Live AWS evidence
3. An explicit limitation

---

## Instructions for Artifact Evaluation

A reviewer should accept narrow evidence claims only when the repository points to:

- Concrete artifacts
- Commands
- Fixtures
- Tests
- Live evidence bundles

A reviewer should reject broad claims implying that:

- model behavior has been proven safe, aligned, or semantically correct
- deployment correctness, compliance certification, or production readiness has been achieved
- live AWS validation exists without a preserved live AWS evidence bundle
- residual risk has been eliminated

Passing local tests means local artifacts behave as expected under the implemented verifier rules.

It does **not** prove:

- live AWS behavior
- production security
- regulatory compliance
- AI safety

---

# Validation Lanes & How to Run

## 1. Local-Only Validation (Zero AWS Credentials)

Use this mode for:

- zero-cost local research
- reviewer checks

It validates:

- schemas
- canonicalization
- fixtures
- receipt verification
- policy logic
- scanner discipline
- unit and integration behavior

```bash
npm ci
npm run lint
npm run validate:claims
npm test
npm run spine:a
```

Run every locally implementable checklist gate (including CDK synthesis but excluding deployment):

```bash
npm run checklist:local
```

---

## 2. AWS Synth Validation

Use this mode to validate generated infrastructure templates without deployment.

```bash
npx cdk synth
npm test
```

> **Note:** CDK synthesis does not create live infrastructure and does not prove runtime behavior.

---

## 3. Bounded Live AWS Evidence Window

Use this mode only when intentionally collecting live AWS evidence.

Local preparation:

```bash
npm run spine:c:local
```

Validate an already-sanitized evidence bundle locally:

```bash
npm run validate:evidence-bundle -- path/to/bundle.json
```

For live capture, see the dedicated:

- preflight runbooks
- evidence-window runbooks
- cleanup runbooks

---

## 4. Governed Invoke

To test deterministic pre/post-model policy decisions locally:

```bash
npm test -- \
  tests/unit/enforcement-runtime/runtime \
  tests/unit/enforcement-runtime/retrieval \
  tests/unit/enforcement-runtime/receipts \
  tests/integration/test_governedInvokeLifecycle.test.ts
```

---

# Security Defaults & Design Stance

Ghost-Ark is a cryptographic tracking substrate, not a system that automatically validates empirical truth claims.

It prefers:

- Narrow claims
- Explicit boundaries
- Replayable workflows
- Tenant-scoped permissions
- Auditable transformations

### Security defaults

- Tenant slugs are mandatory and must pass canonical validation.
- Terraform renders IAM policy variables as `${aws:PrincipalTag/slug}` using `$${...}` HCL escaping.
- Structured logs redact prompts, completions, memory, raw bodies, and credential-like fields by default.
- The default CDK stack creates an asymmetric KMS signing key with `SIGN_VERIFY` usage.
- Governed invoke resolves tenant and user authority from JWT or authorizer context, rejecting client-declared fields.
- Governed invoke fails closed on path/auth tenant mismatch.
- AWS governed invoke mode requires a Bedrock model allowlist.
- If unconfigured, invocation fails closed before Bedrock.
- Plaintext secret values are never injected into CDK Lambda environment variables.

---

# Core Planes

## Ingest

- S3 drops
- SQS fan-in
- Lambda handlers
- DMS / CDC normalization

## Transform

- Glue Spark jobs
- Lightweight Lambda transforms

## Catalog & Govern

- Glue Data Catalog
- Athena
- Lake Formation grants
- LF-Tags
- Row filters
- Column controls

## Attest

- Canonical hashes
- KMS asymmetric signatures
- DynamoDB receipt ledgers
- Lineage ledgers

## Present

- APIs
- OpenSearch evidence search
- Observatory dashboards
- Evidence-pack export

---

# Repository Map

```text
apps/
  user-facing API handlers and console feature surfaces.

packages/
  shared receipt schemas,
  policy compilers,
  lineage models,
  enforcement-runtime primitives.

services/
  ingest,
  transform,
  orchestration,
  governance,
  signing,
  search,
  and ledger implementations.

infra/
  Terraform account bootstrap plus CDK application stacks.

schemas/
  JSON Schema contracts for external validation.

tests/
  unit,
  integration,
  AWS-gated,
  and policy simulation lanes.

docs/
  architecture,
  operations,
  product,
  compliance,
  research,
  and governance documentation.

tools/
  local verifiers,
  smoke scripts,
  governance scanners,
  and evidence utilities.
```

---

# Appendix: Evidence Maturity & Spine Checklist

This checklist tracks evidence maturity, not certification status.

A completed item means the repository contains evidence for that narrow claim.

**"Complete locally" means schemas, deterministic primitives, examples, and focused tests exist inside this repository. It does not imply deployed-environment operation.**

| Item | Status | Spine | Evidence Status |
|:---|:---|:---|:---|
| Claim/evidence matrix | Complete | Spine A | Versioned local documentation and claim boundaries |
| Non-claim scanner | Complete | Spine A | Local enforcement with exact-path quarantine |
| Receipt reproducibility harness | Complete | Spine B | Local tests and fixtures |
| Malicious receipt corpus | Complete | Spine B | Local negative tests |
| Standalone verifier and replay | Complete locally | Spine B | Built-ins-only verifier, differential agreement, manifest replay; no external audit |
| Evidence bundle schema and sanitizer | Complete (Spine C local) | Spine C | L2 schema plus L3 local validator tests; synthetic fixture only |
| Live AWS evidence bundles | Not complete | Spine C | Requires bounded live AWS window |
| Key lifecycle and rotation protocol | Complete locally | Spine D | Epoch/signing policy and runbook tested; live KMS rotation remains AWS-required |
| Guardrail observation schema | Complete locally | Spine E | Closed schema, examples, privacy rules; no runtime capture |
| CC-Framework correlation analysis | Complete locally | Spine F | Adapter, co-failure report, Fréchet bounds; no live/external integration |
| Checkpoint / inclusion / witness model | Partial | Spine G | Local schemas and verifier mechanics; no independent witness |
| Object Lock retention / denial evidence | Not complete | Spine G / Spine C | Requires approved live AWS evidence window |
| Human review workflow | Complete locally | Spine H | Schema, false-positive/escalation examples; no operating queue |
| Incident / failure reporting workflow | Complete locally | Spine H | Schema, synthetic incident; no operational response evidence |
| Risk register | Complete | Spine A | Local risk inventory with residual evidence gaps |
| Control mapping to NIST AI RMF / ISO 42001 | Complete locally | Compliance | Candidate evidence crosswalk; not conformity or certification |
| External reviewer instructions | Complete | Spine A | Local commands, rejection rules, and AWS boundaries |
| Repeatable deployment evidence | Local prep complete | Spine C | Schema, sanitizer, synth gate, runbooks; live bundle absent |

---

# Additional Governance References

- [Claim/Evidence Matrix](./docs/governance/claim-evidence-matrix.md)
- [Risk Register](./docs/governance/risk-register.md)
- [External Reviewer Guide](./docs/governance/external-reviewer-guide.md)
- [Claims Boundary](./docs/release/CLAIMS_BOUNDARY.md)
- [Non-Claims](./docs/compliance/non-claims.md)
