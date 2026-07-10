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
tests/differential/nodeIndependentVerifier.test.ts
```

Run:

```bash
npm run receipt:verify:corpus
npm run receipt:verify:agreement
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
| MAL-019 | required policy hash removed | schema |
| MAL-020 | execution nonce mutation | verifier |
| MAL-021 | timestamp mutation | verifier |
| MAL-022 | non-ASCII canonicalization mutation | verifier |
| MAL-023 | unsigned top-level field smuggling | schema |
| MAL-024 | malformed JSON | loader |
| MAL-025 | missing signature | schema |
| MAL-026 | unsupported receipt schema version | schema |

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
- the standalone Node verifier rejects every manifest case at the declared boundary
- the standalone and production verifier paths agree on end-to-end acceptance for every manifest case
- local RSA-PSS and AWS KMS `MessageType=DIGEST` signature treatments are tested as distinct modes
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
| EXP-012 | wrong verifier tenant using a valid signature | covered by MAL-014 |
| EXP-013 | wrong public key | covered by standalone-verifier differential test; not yet a manifest fixture |
| EXP-014 | unsupported receipt version | covered by MAL-026 |
| EXP-015 | malformed JSON | covered by MAL-024 |
| EXP-016 | missing signature | covered by MAL-025 |
| EXP-017 | missing policy hash or equivalent policy binding | covered by MAL-019 |
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

- Production TypeScript verifier: the repository runtime path used by receipt consumers
- Standalone Node verifier: `verifiers/node/ghost_receipt_verify.mjs`, which imports Node built-ins only and does not import Ghost-Ark emitter, schema, or verifier packages
- Python verifier: a separate stdlib-only cross-language path; it is not required by the Node-based Spine B gate
- Consumer-boundary tests: checks that may reject a cryptographically valid receipt because it violates tenant or runtime expectations

A verifier should not mark an attack as covered unless the test asserts the expected rejection condition.

The standalone Node verifier is implementation-independent from the production verifier at the source-import boundary. It remains maintained in the same repository and follows the same written protocol, so agreement is local differential evidence, not external review or formal correctness evidence.

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
- the standalone verifier does not import the emitter or production verifier

## Suggested Spine B Completion Gate

A reviewer can run the current Spine B gate with:

```bash
npm run spine:b
```

The standalone verifier can also be exercised directly without `ts-node` or Ghost-Ark package imports:

```bash
node verifiers/node/ghost_receipt_verify.mjs \
  --receipt examples/reproducibility/receipts/hmac-baseline.receipt.json \
  --hmac-secret ghost-ark-repro-signing-dev-only-test-vector-v1 \
  --expected-key-id local-dev-hmac
```

`spine:b` includes Spine A, deterministic reproducibility replay, the legacy sample verifier, the standalone verifier smoke command, the production-verifier corpus replay, and standalone-versus-production agreement tests. It is local-only and performs no AWS calls.

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

1. Add key-manifest epoch, key retirement/revocation, chain-fork, checkpoint-root, and duplicate-id cases as those protocols mature.
2. Add an exported adversarial replay bundle for reviewers who do not want to run the full repository.
3. Obtain external review of the written protocol and standalone verifier instead of treating same-repository agreement as full independence.
4. Keep the claim/evidence matrix synchronized with the actual corpus coverage.
