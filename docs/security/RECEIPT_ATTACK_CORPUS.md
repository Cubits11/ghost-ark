# Receipt Attack Corpus

## Purpose

The receipt attack corpus defines malformed or adversarial Ghost-Ark decision receipts that must fail closed.

The goal is to ensure Ghost-Ark does not only verify happy-path receipts. It must reject corrupted receipt identities, digests, signatures, envelopes, key identities, chain links, tenant boundaries, and canonical payload bindings.

## Claim Boundary

Passing this corpus proves only that the listed receipt mutations fail under current Ghost-Ark verifier and consumer-boundary rules.

It does not prove:

- all attacks are covered
- model outputs are safe
- deployment is secure
- compliance is achieved
- AWS-live execution occurred
- receipt logs are complete
- no receipts were withheld
- runtime integrity or hardware attestation
- future receipt behavior
- correctness of every parser or canonicalization edge case

## Corpus Location

Manifest:

```text
examples/malicious-receipts/manifest.json
```

Receipts:

```text
examples/malicious-receipts/receipts/
```

Test:

```text
tests/security/receipt-negative-corpus.test.ts
```

Run:

```bash
npx vitest run tests/security/receipt-negative-corpus.test.ts
```

## Attack Classes

The current corpus covers at least:

| Attack ID | Attack class | Expected rejection boundary |
|---|---|---|
| MAL-001 | altered receipt id | verifier |
| MAL-002 | altered envelope digest | verifier |
| MAL-003 | altered signature | verifier |
| MAL-004 | altered key id | verifier |
| MAL-005 | KMS alias key id | verifier |
| MAL-006 | signature algorithm mismatch | verifier |
| MAL-007 | envelope schema version mutation | verifier |
| MAL-008 | envelope extra field | verifier |
| MAL-009 | envelope missing field | verifier |
| MAL-010 | standard base64 envelope where base64url is required | verifier |
| MAL-011 | malformed base64url envelope | verifier |
| MAL-012 | previous receipt hash mutation | verifier |
| MAL-013 | tenant hash mutation | verifier |
| MAL-014 | cross-tenant expectation mismatch | consumer boundary |
| MAL-015 | action_taken multiplicity mutation | verifier/schema boundary |
| MAL-016 | signature over wrong canonical payload | verifier |
| MAL-017 | input digest mutation | verifier |
| MAL-018 | retrieved context digest mutation | verifier |

## Expected Behavior

For ordinary malformed receipts:

```text
verifyDecisionReceipt(...).verdict === false
```

For cross-tenant cases, cryptographic verification may pass, but the consumer tenant-expectation boundary must reject the receipt.

This distinction matters. A cryptographically valid receipt can still be unacceptable to a tenant-scoped consumer if the tenant identity commitment does not match the expected tenant boundary.

## Review Rule

A malicious fixture is useful only if it records:

- attack id
- mutated field
- mutation description
- expected verdict
- expected rejection phase
- expected error substring or failure class
- claim boundary

A fixture that does not assert a failure mode is not an adversarial test. It is just a corrupted file.

## Current Status

The current corpus test asserts that:

- every untampered base fixture is accepted
- every mutant fails closed under its expected rule
- cross-tenant mismatch is rejected at the consumer boundary
- the corpus carries an explicit non-claim

## Minimum Expansion Targets

Future Spine B hardening should add or confirm fixtures for:

| Target ID | Attack class | Status |
|---|---|---|
| EXP-001 | key manifest epoch mismatch | future work |
| EXP-002 | retired key acceptance | future work |
| EXP-003 | revoked key acceptance | future work |
| EXP-004 | chain fork ambiguity | future work |
| EXP-005 | checkpoint root mismatch | future work |
| EXP-006 | duplicate receipt ids | future work |
| EXP-007 | timestamp rollback | future work |
| EXP-008 | schema downgrade attempts | future work |
| EXP-009 | JSON numeric edge cases | future work |
| EXP-010 | Unicode key ordering edge cases | future work |
| EXP-011 | sparse array or non-JSON host object attacks where applicable | future work |
| EXP-012 | wrong verifier tenant using a valid signature | future work |
| EXP-013 | wrong public key | future work |
| EXP-014 | unsupported receipt version | future work |
| EXP-015 | malformed JSON | future work |
| EXP-016 | missing signature | future work |
| EXP-017 | missing policy hash or equivalent policy binding | future work |
| EXP-018 | replayed receipt under a different invocation/session boundary | future work |
| EXP-019 | signer/key manifest mismatch | future work |
| EXP-020 | receipt generated under deprecated canonicalization version | future work |

## Manifest Requirements

The malicious receipt manifest should record each case as a structured object.

Required fields:

```json
{
  "caseId": "MAL-001",
  "file": "altered-receipt-id.json",
  "attackClass": "altered-receipt-id",
  "expectedVerdict": "FAIL",
  "expectedRejectionBoundary": "verifier",
  "expectedFailureClass": "receipt-id-mismatch",
  "applicable": true,
  "claimBoundary": "This fixture proves only that this mutation is rejected under current verifier rules."
}
```

A case may be marked `applicable: false` only when the current receipt schema does not contain the field or mechanism required to express that attack honestly.

## Verifier Boundary

The corpus may be evaluated by one or more verifier implementations.

Current verifier boundaries should be documented separately:

- Node verifier: primary local verifier path
- Python verifier: independent or partially independent verifier path, if present
- Consumer-boundary tests: checks that may reject a cryptographically valid receipt because it violates tenant or runtime expectations

A verifier should not mark an attack as covered unless the test asserts the expected rejection condition.

## Acceptance Criteria

A reviewer should consider this corpus useful only if:

- the manifest exists
- every malicious case has an expected verdict
- every malicious case has an expected rejection boundary
- the test suite fails if an applicable malicious fixture is accepted
- valid fixtures still pass
- cross-tenant rejection is tested separately from cryptographic validity
- the corpus documentation does not claim complete attack coverage
- the corpus can be run locally without AWS credentials
- failures are deterministic and reproducible

## Suggested Spine B Completion Gate

A stronger Spine B gate should eventually include:

```bash
npm run scan:claims
npx vitest run tests/security/receipt-negative-corpus.test.ts
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

If a Python verifier is added:

```bash
python3 tools/verifiers/ghost_verify.py \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

The Python verifier should not be described as fully independent unless it avoids importing production Ghost-Ark TypeScript packages and independently implements the relevant canonicalization and signature checks.

## Non-Claims

This corpus does not show that Ghost-Ark is secure for production use.

This corpus does not show that all receipt attacks are covered.

This corpus does not show live AWS behavior.

This corpus does not show that a model output is true, safe, aligned, or compliant.

This corpus does not show deployment correctness.

This corpus does not show compliance certification.

This corpus is local adversarial evidence for the listed receipt mutation classes only.

## Next Work

The next improvement is not to claim broader security. The next improvement is to make the corpus more replayable.

Recommended next steps:

1. Normalize every malicious fixture into a manifest-driven test.
2. Add unsupported-version, malformed-JSON, missing-signature, wrong-public-key, and wrong-tenant cases if not already present.
3. Add a Python verifier agreement test if the Python verifier exists.
4. Add an exported adversarial replay bundle for reviewers who do not want to run the full repository.
5. Keep the claim/evidence matrix synchronized with the actual corpus coverage.
