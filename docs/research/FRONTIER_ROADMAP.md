# Ghost-Ark Research Frontier Roadmap

Ghost-Ark is evolving from an AWS-native verifiable AI infrastructure reference architecture into a research-grade system for confidential, formally checked, privacy-preserving, externally auditable AI governance.

This roadmap is intentionally staged. The project must not claim hardware attestation, formal verification, zero-knowledge execution, or decentralized transparency until each layer has executable evidence.

## Phase 0: Research Control Plane

Goal: define the manifests, schemas, verification interfaces, and threat boundaries required for advanced assurance.

Deliverables:

- Frontier manifest schema
- Threat model
- Attestation manifest schema
- Formal invariant registry
- zk receipt interface schema
- Witness checkpoint schema
- Verification CLI skeleton

Success criterion:

A reviewer can inspect what the project claims, what it does not claim, and what evidence is required before any advanced assurance claim is accepted.

## Phase A: Nitro Enclave Attestation

Goal: bind secret release and receipt signing to measured enclave code identity.

Claims allowed only after implementation:

- The enclave image file measurement is reproducibly generated.
- KMS decrypt/generate operations require matching attestation measurements.
- PCR0, PCR1, PCR2, and PCR8 are recorded and checked.
- Parent instance compromise alone is insufficient to extract sealed secrets.

Non-claims:

- Nitro Enclaves do not prove that the policy is logically correct.
- Nitro Enclaves do not prove the model output is safe.
- Nitro Enclaves do not remove all side-channel or supply-chain risk.

## Phase B: Formal Policy Verification

Goal: prove or exhaustively check tenant isolation and policy safety invariants.

Claims allowed only after implementation:

- Tenant A cannot access Tenant B resources under the formal model.
- Deny precedence is preserved.
- Policy compilation preserves intended semantics under tested conditions.
- Differential checks against AWS IAM semantics pass for supported policy fragments.

Non-claims:

- Bounded model checking is not a proof over all possible AWS behavior.
- A formal model is only as complete as its assumptions.

## Phase C: Zero-Knowledge Execution Receipts

Goal: prove selected governance computations executed correctly without revealing private inputs.

Claims allowed only after implementation:

- A verifier can check that a specific guest image ID produced a public journal.
- The receipt binds policy hash, decision hash, and canonical output hash.
- Private prompt/context material is not disclosed in the public journal.

Non-claims:

- zkVM receipts do not prove semantic model safety.
- zkVM receipts do not make large LLM inference cheap by default.
- A zk proof only covers the program actually encoded into the guest.

## Phase D: Witness-Cosigned Transparency

Goal: prevent unilateral operator rewriting, deletion, or split-view logging of governance receipts.

Claims allowed only after implementation:

- Checkpoints are Merkle-rooted.
- Independent witnesses sign checkpoint roots.
- Monitors verify consistency between checkpoints.
- Clients can verify inclusion proofs and witness signatures.

Non-claims:

- Witnesses do not prove the original policy decision was correct.
- Transparency does not provide confidentiality by itself.
