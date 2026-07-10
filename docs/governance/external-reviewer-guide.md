# External Reviewer Guide

This guide tells a skeptical external reviewer exactly what Ghost-Ark claims, what it does not claim, and how to check the claims locally with zero AWS credentials.

## What Ghost-Ark Claims

- Receipt payloads canonicalize deterministically under Ghost-Ark canonicalization rules (CLAIM-001).
- A local verifier checks canonical receipt identity, payload digest, tenant expectation, and RSA-PSS signature validity for supplied artifacts (CLAIM-002).
- A corpus of tampered receipts is rejected by local negative tests (CLAIM-003).
- A standalone Node verifier has no Ghost-Ark package imports and agrees with the production verifier on the committed adversarial corpus (CLAIM-004, local source-boundary evidence only).
- The enforcement runtime evaluates deterministic policy decisions, fails closed, and emits decision receipts in local tests (CLAIM-005, local path only).
- A locally tested Draft 2020-12 contract validates supplied evidence-bundle lifecycle fields and rejects synthetic-to-live relabeling, incomplete completion claims, and enumerated leak patterns (CLAIM-018, local artifact checks only).
- Closed local schemas and validators exist for guardrail observations, human-review decisions, incidents, checkpoints, and candidate framework mappings (CLAIM-009, CLAIM-011, CLAIM-013, CLAIM-014, CLAIM-015).
- A local CC adapter produces deterministic co-failure tables, pairwise phi values, Wilson intervals, and Fréchet bounds from complete supplied cohorts (CLAIM-012, local mechanics only).
- A key-manifest primitive distinguishes historical verification eligibility from ACTIVE-only new signing authorization (CLAIM-019, local policy only).
- Local witness checkpoint consistency and signature mechanics exist for maintainer-controlled fixtures (CLAIM-020, not independent witness evidence).
- A claim scanner blocks forbidden assurance wording on public claim surfaces (`npm run scan:claims`).

Each claim maps to a row in the [Claim/Evidence Matrix](claim-evidence-matrix.md) with evidence location, command, and limitation.

## What Ghost-Ark Does Not Claim

- It does not claim model outputs are true, safe, aligned, or semantically correct.
- It does not claim compliance certification, formal verification, or audit completion.
- It does not claim production readiness or enterprise readiness.
- It does not claim tenant isolation is proven (requires live API/Cognito/IAM evidence).
- It does not claim KMS signing provenance from HMAC-dev fixtures (requires live KMS evidence).
- It does not claim live AWS validation without a preserved, sanitized live evidence bundle.
- It does not claim residual risk has been eliminated.

## Local Verification Path

All commands below run with zero AWS credentials.

```bash
npm ci
npm run spine:a
```

`spine:a` runs, in order: `lint`, `validate:claims`, `scan:claims`, `test`, `docs:check`. A failure in any step fails the gate.

For the full local receipt-evidence gate, run `npm run spine:b`. It first runs Spine A, then replays the reproducibility manifest, sample receipt, standalone verifier, malicious corpus, and standalone-versus-production agreement tests. It performs no AWS calls.

For the full local Spine C preparation gate, run:

```bash
npm run spine:c:local
```

This runs Spine B, validates the explicitly synthetic evidence-bundle fixture, builds the repository, and synthesizes CDK with Search Mode disabled. It performs no deployment and creates no live evidence. The sample must report `synthetic-non-live`, `liveAwsCallsPerformed: false`, and `NOT_RUN` observations.

To validate another already-sanitized bundle file locally:

```bash
npm run validate:evidence-bundle -- path/to/bundle.json
```

To run every locally implementable checklist gate, including Core Mode CDK synthesis but no deployment:

```bash
npm run checklist:local
```

That command covers Spines A/B, Spine C local preparation, key lifecycle, guardrail observation, CC analysis, local transparency/witness mechanics, human review/incident artifacts, and the candidate framework crosswalk.

## Receipt Verification

```bash
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

Then tamper with any of the payload, tenant, digest, algorithm, or signature fields and re-run. The verdict must change to FAIL.

To exercise the implementation that imports Node built-ins only:

```bash
npm run receipt:verify:independent
```

## Malicious Corpus Verification

```bash
npm run receipt:verify:corpus
npm run receipt:verify:agreement
```

The first command replays the manifest through the production verifier. The second replays it through the standalone verifier and checks end-to-end agreement. See `docs/security/RECEIPT_ATTACK_CORPUS.md` for the corpus rationale.

## Claim Scanner

```bash
npm run scan:claims
```

The scanner walks the repository, skips generated directories, and fails closed on filesystem or parse errors. It exempts only an exact-path allowlist of policy, boundary, and test files whose purpose is to quote rejected wording. It does not exempt the README, runbooks, or any directory wildcard. To audit the allowlist, read `allowedPolicyFiles` in `tools/research/check-forbidden-claims.mjs`.

## What Passing Tests Mean

A passing local verifier result means the supplied artifacts are internally consistent under Ghost-Ark verifier rules. It does not prove model safety, deployment correctness, compliance, or production security.

Passing `npm test` means the implemented canonicalization, signing envelope, policy, retrieval, and verifier rules behave as specified against local fixtures and mocks.

Passing the agreement test shows that two same-repository implementation paths make the same acceptance decision on the committed corpus. It is not evidence of external audit, organizational independence, or formal correctness.

Passing `validate:evidence-bundle` means the supplied JSON matches the bundle schema, semantic lifecycle constraints, and enumerated leak rules. It does not independently establish that an AWS call happened, and the leak scan cannot identify every context-specific sensitive value.

Passing schema and linkage tests means supplied synthetic artifacts satisfy their closed local contracts. It does not show that a guardrail ran, a human reviewed an event, an incident team responded, a witness was independent, or an organizational control operated.

## What Passing Tests Do Not Mean

- They do not prove live AWS behavior (IAM, Cognito, KMS, DynamoDB, Bedrock, S3).
- They do not prove tenant isolation in a deployed environment.
- They do not prove key provenance beyond the fixture keys used in tests.
- They do not prove the model's outputs are correct, safe, or compliant.
- They do not prove the infrastructure templates deploy or operate correctly.

## What Requires Live AWS Evidence

- Tenant isolation across API Gateway, Cognito, and IAM (CLAIM-006).
- KMS signing provenance (CLAIM-007).
- DynamoDB receipt persistence behavior (CLAIM-008).
- Object Lock transparency bundles (CLAIM-010).
- Repeatable deployment evidence: deploy, smoke, capture, destroy (CLAIM-016).
- Cost-bounded live validation lifecycle execution (CLAIM-017).
- Deployed KMS rotation, old-key signing denial, and compromise response (CLAIM-019 deployed boundary).
- Live guardrail capture, operating human review/incident response, and independently operated witnesses.

Live evidence counts only when a human-approved, sanitized, preserved live bundle identifies a clean commit, hashed account and principal, region, stage, bounded window, stack results, scoped observations, artifact digests, applicable receipt checks, and confirmed cleanup. The checked-in synthetic sample is not live evidence.

Use the dedicated [preflight](../operations/runbooks/live-aws-evidence-preflight.md), [window](../operations/runbooks/live-aws-evidence-window.md), and [cleanup](../operations/runbooks/live-aws-evidence-cleanup.md) runbooks when reviewing a proposed live capture. Their existence is documentation, not an execution record.

## Reviewer Rejection Rules

Reject any claim that:

- asserts model behavior has been proven safe or aligned;
- asserts compliance certification, formal verification, or audit completion;
- asserts production readiness or enterprise readiness;
- asserts live AWS validation without pointing to a preserved evidence bundle;
- generalizes a single smoke run into ongoing operational assurance;
- presents local fixtures, mocks, or CDK synthesis as live AWS proof;
- presents a declared receipt reference as a cryptographically verified binding;
- presents a framework crosswalk as conformity, certification, legal analysis, or a Statement of Applicability;
- presents a synthetic review or incident example as evidence of an operating human process;
- cannot be traced to a row in the [Claim/Evidence Matrix](claim-evidence-matrix.md).

Focused non-AWS review commands:

```bash
npm run spine:d:local
npm run spine:e:local
npm run spine:f:local
npm run spine:g:local
npm run spine:h:local
npm run spine:compliance:local
```

See also the [Risk Register](risk-register.md), [Claims Boundary](../release/CLAIMS_BOUNDARY.md), and [Non-Claims](../compliance/non-claims.md).
