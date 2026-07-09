# External Reviewer Guide

This guide tells a skeptical external reviewer exactly what Ghost-Ark claims, what it does not claim, and how to check the claims locally with zero AWS credentials.

## What Ghost-Ark Claims

- Receipt payloads canonicalize deterministically under Ghost-Ark canonicalization rules (CLAIM-001).
- A local verifier checks canonical receipt identity, payload digest, tenant expectation, and RSA-PSS signature validity for supplied artifacts (CLAIM-002).
- A corpus of tampered receipts is rejected by local negative tests (CLAIM-003).
- The enforcement runtime evaluates deterministic policy decisions, fails closed, and emits decision receipts in local tests (CLAIM-005, local path only).
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

## Receipt Verification

```bash
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

Then tamper with any of the payload, tenant, digest, algorithm, or signature fields and re-run. The verdict must change to FAIL.

## Malicious Corpus Verification

```bash
npm test
```

The suite includes negative tests that mutate receipts and assert rejection. See `docs/security/RECEIPT_ATTACK_CORPUS.md` for the corpus rationale.

## Claim Scanner

```bash
npm run scan:claims
```

The scanner walks the repository, skips generated directories, and fails closed on filesystem or parse errors. It exempts only an exact-path allowlist of policy, boundary, and test files whose purpose is to quote rejected wording. It does not exempt the README, runbooks, or any directory wildcard. To audit the allowlist, read `allowedPolicyFiles` in `tools/research/check-forbidden-claims.mjs`.

## What Passing Tests Mean

A passing local verifier result means the supplied artifacts are internally consistent under Ghost-Ark verifier rules. It does not prove model safety, deployment correctness, compliance, or production security.

Passing `npm test` means the implemented canonicalization, signing envelope, policy, retrieval, and verifier rules behave as specified against local fixtures and mocks.

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

Live evidence counts only when a sanitized, preserved evidence bundle exists in the repository with the run's command, scope, region, and timestamp.

## Reviewer Rejection Rules

Reject any claim that:

- asserts model behavior has been proven safe or aligned;
- asserts compliance certification, formal verification, or audit completion;
- asserts production readiness or enterprise readiness;
- asserts live AWS validation without pointing to a preserved evidence bundle;
- generalizes a single smoke run into ongoing operational assurance;
- presents local fixtures, mocks, or CDK synthesis as live AWS proof;
- cannot be traced to a row in the [Claim/Evidence Matrix](claim-evidence-matrix.md).

See also the [Risk Register](risk-register.md), [Claims Boundary](../release/CLAIMS_BOUNDARY.md), and [Non-Claims](../compliance/non-claims.md).
