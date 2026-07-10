# Receipt Truth Ladder

This ladder defines increasing levels of evidence strength for Ghost-Ark decision receipts.

It is a claim-discipline tool, not a certification claim.

## Claim Boundary

The ladder describes what a receipt artifact can support under stated verifier rules.

It does not establish:

- broad AI-safety assurance
- semantic truth of model outputs
- regulatory status
- production readiness
- deployment approval
- runtime integrity
- hardware attestation
- ledger completeness
- future system behavior

## Level 0 — Unstructured Log

A runtime writes plain text or ad hoc logs.

Supports:

- a weak record that something may have been written

Does not support:

- stable schema validation
- canonical identity
- tamper evidence
- signer provenance
- replayability

Ghost-Ark status:

- below the current decision receipt standard

Artifact required to advance:

- structured receipt schema

## Level 1 — Structured Receipt

A runtime emits a schema-shaped JSON receipt.

Supports:

- machine-readable fields
- basic schema validation

Does not support:

- canonical identity
- digest replay
- signer provenance
- external reproducibility

Ghost-Ark status:

- supported by `ghost.receipt.v1` decision receipt schema validation

Artifact required to advance:

- canonical hashing

## Level 2 — Canonical Hash Commitment

A structured receipt has a deterministic canonical form and digest.

Supports:

- recomputation of the canonical payload hash
- detection of many byte-level or field-level mutations

Does not support:

- signer authority
- key identity
- runtime correctness
- semantic validity of recorded decisions

Ghost-Ark status:

- supported by receipt identity and digest functions

Artifact required to advance:

- signed envelope

## Level 3 — Signed Receipt

A receipt includes a signature envelope over the canonical unsigned receipt.

Supports:

- cryptographic binding between a signing key path and the canonical receipt payload

Does not support:

- model-output correctness
- operational safety
- key-custody assurance by itself
- completeness of the receipt chain

Ghost-Ark status:

- supported for dev-only local HMAC and KMS-style RSA verification paths

Artifact required to advance:

- committed reproducibility fixtures

## Level 4 — Reproducible Signed Receipt

A reviewer can recompute the receipt id, canonical payload, digest, signature envelope binding, and supported signature result from committed fixtures.

Supports:

- replayable receipt identity and digest checks
- deterministic fixture verification
- external inspection of non-sensitive synthetic receipts

Does not support:

- AWS-live execution
- production deployment posture
- runtime integrity
- ledger completeness

Ghost-Ark status:

- achieved for the committed reproducibility fixtures in `examples/reproducibility/`

Artifact required to advance:

- adversarial receipt corpus

## Level 5 — Adversarially Tested Receipt

Known malformed receipts are checked and expected to fail closed.

Supports:

- rejection of listed mutation classes
- stronger confidence in verifier fail-closed behavior for the covered cases

Does not support:

- exhaustive attack coverage
- absence of unknown parser or canonicalization bugs
- deployment approval

Ghost-Ark status:

- achieved for the current malicious receipt corpus in `examples/malicious-receipts/`

Artifact required to advance:

- independent verifier implementation

## Level 6 — Independently Checked Receipt

A second implementation recomputes core receipt commitments without importing the primary TypeScript verifier code.

Supports:

- partial cross-implementation agreement
- reduced dependence on a single implementation path for supported checks

Does not support:

- full formal correctness
- complete cryptographic parity unless all signature modes are independently verified
- absence of shared specification errors

Ghost-Ark status:

- achieved for the bounded single-receipt fixture and malicious-corpus scope by `verifiers/node/ghost_receipt_verify.mjs`, which imports Node built-ins only and verifies strict schema/envelope rules, receipt identity, digest binding, tenant expectation, dev-only HMAC, and both documented RSA-PSS digest treatments
- separately exercised by the stdlib-only Python verifier when Python is available
- not externally reviewed and not parity-complete for key manifests, receipt chains, checkpoints, attestations, or ledger completeness

Artifact required to strengthen this level:

- external review or reimplementation plus parity tests for key manifests, chains, checkpoints, and inclusion proofs

## Level 7 — Cloud Evidence-Bound Receipt

A receipt is tied to sanitized live cloud evidence such as deployed stack metadata, KMS key identifiers, CloudWatch log excerpts, smoke-test output, and verifier output.

Supports:

- bounded evidence that a specific cloud validation run occurred and produced inspectable artifacts

Does not support:

- production readiness
- regulatory status
- model-output safety
- runtime attestation
- future behavior

Ghost-Ark status:

- not achieved by the local Spine B work

Artifact required to advance:

- live AWS evidence bundle with sanitizer and replay instructions

## Level 8 — Attestation-Bound Receipt

A receipt is bound to measured execution-environment evidence under an explicit attestation model.

Supports:

- inspection of selected runtime measurements and their relationship to receipt generation

Does not support:

- semantic correctness
- all-runtime compromise resistance
- organizational approval
- broad system assurance

Ghost-Ark status:

- not achieved

Artifact required to advance:

- attestation verifier, measurement policy, and evidence bundle

## Level 9 — Cross-Verifier Consensus Receipt

Multiple independent verifiers agree on receipt identity, digest, signature, key epoch, chain position, and checkpoint inclusion.

Supports:

- stronger implementation diversity
- reduced single-verifier dependence

Does not support:

- truth of model output
- acceptability of model action
- completeness of all possible evidence
- social, legal, or organizational approval

Ghost-Ark status:

- not achieved

Artifact required to advance:

- multiple independent verifier implementations and consensus test corpus

## Level 10 — Audit-Supporting Evidence Object

A receipt becomes part of a broader governance process including risk register, human review, incident workflow, key lifecycle, evidence retention, control mapping, and external review.

Supports:

- structured audit support under defined controls and evidence boundaries

Does not support:

- certification by itself
- broad AI-safety assurance
- guaranteed compliance outcome
- automatic deployment approval

Ghost-Ark status:

- aspirational; partially supported by current receipt, corpus, and claim-boundary work

Artifact required to advance:

- governance spine, live evidence bundle, review workflow, incident workflow, key lifecycle, and control mapping
