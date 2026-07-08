# Ghost-Ark Assurance Maturity Ladder

Ghost-Ark must distinguish aspirational architecture from implemented, testable, externally verifiable assurance.

This ladder defines the maturity level of any security, privacy, cryptographic, formal-methods, or AI-governance claim made by the project.

## L0: Aspirational Claim

A design idea exists, but no durable artifact exists yet.

Example:

> Ghost-Ark may eventually support zkVM execution receipts.

Allowed language:

- planned
- proposed
- research direction
- future work

Forbidden language:

- implemented
- proven
- verified
- production-ready

## L1: Documented Design

The claim is described in documentation with scope, assumptions, and non-claims.

Required evidence:

- design document
- threat model section
- non-claims

Example:

> Ghost-Ark has a documented design for witness-cosigned transparency checkpoints.

## L2: Schema-Bound Artifact

The claim has a schema, manifest, or typed representation.

Required evidence:

- JSON schema
- TypeScript interface
- example artifact

Example:

> Ghost-Ark defines a schema for zk execution receipts.

## L3: Unit-Tested Primitive

The claim has deterministic local tests.

Required evidence:

- unit tests
- negative tests
- deterministic behavior

Example:

> Ghost-Ark can compute deterministic Merkle checkpoint roots locally.

## L4: Integration-Tested Subsystem

The claim is tested across multiple internal components.

Required evidence:

- integration tests
- failure-mode tests
- realistic fixture data

Example:

> Ghost-Ark can emit and verify decision receipts across runtime and repository boundaries.

## L5: Cloud-Validated Runtime Evidence

The claim has been validated against live cloud infrastructure.

Required evidence:

- AWS command output
- CloudWatch logs
- KMS verification output
- deployed stack metadata
- generated receipts

Example:

> Ghost-Ark has emitted a governed invocation receipt from a live AWS deployment.

## L6: Reproducible External Verification

A third party can independently verify the claim from published artifacts.

Required evidence:

- verifier CLI
- pinned artifact hashes
- public schemas
- replayable receipt bundle
- no private database dependency

Example:

> An external verifier can validate a receipt bundle and checkpoint without trusting the live Ghost-Ark server.

## L7: Independent Witness/Auditor Confirmation

The claim is confirmed by independent witness signatures or external auditors.

Required evidence:

- witness signatures
- monitor logs
- independent checkpoint copies
- consistency checks

Example:

> Multiple independent witnesses cosigned the same Ghost-Ark checkpoint root.

## L8: Formal or Cryptographic Proof

The claim is backed by a formal proof, model checker result, SMT proof, zk proof, or equivalent cryptographic evidence.

Required evidence:

- TLA+/Lean/SMT artifact
- model checker output
- zk receipt
- verifier implementation
- proof reproduction instructions

Example:

> A verifier checked that a zk receipt binds a public policy hash, decision hash, prompt commitment, and output commitment to a specific guest image.

## Claim Classification Examples

### Claim: Ghost-Ark supports Nitro Enclave attestation

Current maturity during manifest-only implementation:

L2: Schema-bound artifact

After unit tests:

L3: Unit-tested primitive

After real enclave build and KMS attestation-bound decrypt:

L5: Cloud-validated runtime evidence

After external verifier checks attestation docs and release artifacts:

L6 or above

### Claim: Ghost-Ark proves AI safety

Classification:

Forbidden.

No current artifact can support this claim. Ghost-Ark can provide verifiable execution evidence, not semantic guarantees of model safety.

### Claim: Ghost-Ark provides deterministic Merkle checkpoint roots

Classification:

L3 after unit-tested Merkle primitive.

### Claim: Ghost-Ark has decentralized witness-cosigned transparency

Classification:

L1 or L2 until independent witnesses exist.

Single local dev witness signatures are not decentralization.

## Required Rule

Every major README, paper, architecture diagram, or public claim must be classifiable under this ladder.

If a claim cannot be classified, it must be rewritten or removed.
