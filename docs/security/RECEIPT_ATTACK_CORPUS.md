# Receipt Attack Corpus

## Purpose

The receipt attack corpus defines malformed or adversarial Ghost-Ark decision receipts that must fail closed.

The goal is to ensure Ghost-Ark does not only verify happy-path receipts. It must reject corrupted receipt identities, digests, signatures, envelopes, key identities, chain links, tenant boundaries, and canonical payload bindings.

Claim Boundary

Passing this corpus proves only that the listed receipt mutations fail under current Ghost-Ark verifier and consumer-boundary rules.

It does not prove:

* all attacks are covered
* model outputs are safe
* deployment is secure
* compliance is achieved
* AWS-live execution occurred
* receipt logs are complete
* no receipts were withheld
* runtime integrity or hardware attestation

# Corpus Location

Manifest: examples/malicious-receipts/manifest.json
Receipts: examples/malicious-receipts/receipts/
Test: tests/security/receipt-negative-corpus.test.ts
Run: npx vitest run tests/security/receipt-negative-corpus.test.ts

Attack Classes

The corpus covers at least:

* altered receipt id
* altered envelope digest
* altered signature
* altered key id
* KMS alias key id
* signature algorithm mismatch
* envelope schema version mutation
* envelope extra field
* envelope missing field
* standard base64 envelope where base64url is required
* malformed base64url envelope
* previous receipt hash mutation
* tenant hash mutation
* cross-tenant expectation mismatch
* action_taken multiplicity mutation
* signature over wrong canonical payload
* input digest mutation
* retrieved context digest mutation

Expected Behavior

For ordinary malformed receipts: verifyDecisionReceipt(...).verdict === false
For Cross-Tenant cases: cryptographic verification may pass, but the consumer tenant-expectation boundary must reject the receipt.

This distinction matters. A cryptographically valid receipt can still be unacceptable to a tenant-scoped consumer if the tenant identity commitment does not match the expected tenant boundary.

Review Rule

A malicious fixture is useful only if it records:

* attack id
* mutated field
* mutation description
* expected verdict
* expected rejection phase
* expected error substring or failure class
* claim boundary

A fixture that does not assert a failure mode is not an adversarial test. It is just a corrupted file.

Current Status

The current corpus test passes and asserts that:

* every untampered base fixture is accepted
* every mutant fails closed under its expected rule
* cross-tenant mismatch is rejected at the consumer boundary
* the corpus carries an explicit non-claim

Future Work

Add attacks for:

* key manifest epoch mismatch
* retired key acceptance
* revoked key acceptance
* chain fork ambiguity
* checkpoint root mismatch
* duplicate receipt ids
* timestamp rollback
* schema downgrade attempts
* JSON numeric edge cases
* Unicode key ordering edge cases
* sparse array / non-JSON host object attacks where applicable
    EOF

cat > docs/research/RECEIPT_TRUTH_LADDER.md <<‘EOF’

Receipt Truth Ladder

This ladder defines increasing levels of evidence strength for AI governance receipts.

It is a claim-discipline tool, not a certification claim.

Level 0 — Log

A runtime writes unstructured text.

Proves:

* something may have been recorded

Does not prove:

* structure
* identity
* integrity
* provenance
* reproducibility

Ghost-Ark status:

* below current receipt standard

Artifact required to advance:

* structured schema

Level 1 — Structured Log

A runtime emits structured JSON.

Proves:

* fields are present in a machine-readable format

Does not prove:

* canonical identity
* tamper evidence
* signer authorization
* replayability

Ghost-Ark status:

* below current decision receipt standard

Artifact required to advance:

* canonical hashing

Level 2 — Hashed Record

A structured record has a hash commitment.

Proves:

* byte-level or canonical-payload integrity if recomputed

Does not prove:

* signer provenance
* policy execution
* runtime integrity
* semantic truth

Ghost-Ark status:

* supported as part of receipt identity and digest logic

Artifact required to advance:

* signature envelope

Level 3 — Signed Receipt

A receipt is signed by a declared signing path.

Proves:

* a signing authority produced or authorized a signature over a payload

Does not prove:

* the model output was safe
* the signer was uncompromised
* the runtime was honest
* the receipt log is complete

Ghost-Ark status:

* supported for dev-only HMAC and KMS-style signing paths

Artifact required to advance:

* reproducible canonical fixture

Level 4 — Canonically Reproducible Signed Receipt

A reviewer can recompute receipt id, canonical payload, digest, envelope binding, and signature result from committed fixtures.

Proves:

* receipt identity and digest claims are replayable under documented rules

Does not prove:

* live AWS execution
* deployment safety
* ledger completeness
* runtime integrity

Ghost-Ark status:

* achieved for committed reproducibility fixtures

Artifact required to advance:

* adversarial receipt corpus

Level 5 — Adversarially Tested Receipt

Known malformed receipts are expected to fail closed.

Proves:

* the verifier rejects listed mutation classes

Does not prove:

* complete attack coverage
* absence of unknown parser/canonicalization bugs
* production safety

Ghost-Ark status:

* achieved for current malicious receipt corpus

Artifact required to advance:

* independent verifier

Level 6 — Independently Verified Receipt

A second implementation recomputes core receipt commitments without importing the primary verifier code.

Proves:

* partial cross-implementation agreement for supported checks

Does not prove:

* full formal correctness
* full cryptographic parity unless signatures are independently verified
* absence of shared specification errors

Ghost-Ark status:

* partially achieved with stdlib-only Python verifier skeleton for digest, identity, envelope, and dev-only HMAC checks

Artifact required to advance:

* full independent verifier parity, including RSA-PSS and key manifest checks

Level 7 — Cloud Evidence-Bound Receipt

A receipt is tied to sanitized live cloud evidence: deployment id, command transcript, KMS key ARN, CloudWatch traces, stack outputs, and verification report.

Proves:

* a specific cloud validation run produced bounded evidence

Does not prove:

* production readiness
* safety
* compliance
* runtime attestation
* future behavior

Ghost-Ark status:

* not achieved in this Spine B PR

Artifact required to advance:

* live AWS evidence bundle

Level 8 — Attestation-Bound Receipt

A receipt is bound to hardware/runtime attestation measurements.

Proves:

* receipt claims are tied to a measured execution environment under an explicit attestation model

Does not prove:

* semantic safety
* policy correctness
* organizational compliance
* absence of all runtime compromise

Ghost-Ark status:

* not achieved

Artifact required to advance:

* supported attestation flow, measurement policy, verifier, and evidence bundle

Level 9 — Cross-Verifier Consensus Receipt

Multiple independent verifiers agree on receipt validity, digest, signature, key epoch, chain position, and checkpoint inclusion.

Proves:

* stronger implementation diversity and reduced single-verifier trust

Does not prove:

* truth of model output
* safety of action
* completeness of all logs
* social or regulatory acceptance

Ghost-Ark status:

* not achieved

Artifact required to advance:

* at least two full independent verifiers and consensus test corpus

Level 10 — Certification-Supporting Evidence Object

A receipt becomes part of a broader control system with risk register, human review, incident workflow, evidence retention, control mapping, and external audit process.

Proves:

* the receipt can support an audit or governance process under defined controls

Does not prove:

* the system is certified by itself
* AI safety is certified
* compliance is guaranteed
* deployment risk is acceptable

Ghost-Ark status:

* aspirational; partially supported by receipt, corpus, and claim-boundary work

Artifact required to advance:

* control mapping, live evidence bundles, human review workflow, incident workflow, key lifecycle, external reviewer process






