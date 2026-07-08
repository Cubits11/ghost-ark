# Ghost-Ark Frontier Threat Model

Ghost-Ark is a verifiable AI infrastructure architecture. Its purpose is to make bounded execution, policy, provenance, receipt, and audit claims independently checkable.

This threat model defines what Ghost-Ark is trying to protect, which adversaries it considers, what each research frontier phase addresses, and what remains out of scope.

## 1. Protected Assets

Ghost-Ark protects the following assets:

- Tenant identity
- Tenant namespace boundaries
- Policy decisions
- Policy versions and hashes
- Prompt commitments
- Retrieval/memory access boundaries
- Consent-gated memory records
- Decision receipts
- KMS signature provenance
- Receipt hash chains
- Merkle checkpoint roots
- Object Lock transparency bundles
- Attestation measurements
- zk execution receipt journals
- Witness-cosigned checkpoint records

## 2. Core Security Properties

Ghost-Ark aims to preserve the following properties:

### Tenant Isolation

A request from Tenant A must not access resources belonging to Tenant B.

### Policy Integrity

The runtime must evaluate the intended policy version and must not silently downgrade, bypass, or replace the policy.

### Receipt Integrity

A decision receipt must bind the decision, tenant context, policy hash, model identity, canonical payload, and signature metadata.

### Key Integrity

Signing and decryption keys must not be usable outside authorized execution contexts.

### Log Integrity

Receipt history must be append-only, checkpointed, and externally verifiable.

### Claim Integrity

The project must not claim more than its evidence supports.

## 3. Adversary Classes

### A1: Malicious Tenant

A malicious tenant attempts to:

- Override tenant identifiers in request bodies
- Access another tenant's memory
- Forge receipt payloads
- Reuse stale receipts
- Abuse model invocation paths
- Trigger policy parser edge cases

### A2: Compromised Application Runtime

An attacker gains control over part of the application runtime and attempts to:

- Bypass policy checks
- Modify decision receipts before signing
- Swap model identifiers
- Disable audit emission
- Inject unsafe environment variables
- Redirect receipt writes

### A3: Compromised Cloud Host

An attacker controls the parent EC2 host or privileged cloud-side execution environment and attempts to:

- Extract secrets
- Inspect plaintext prompts
- Tamper with policy execution
- Modify LLM invocation behavior
- Forge evidence of correct execution

Phase A addresses this using Nitro Enclave attestation and KMS attestation-bound key release.

### A4: Policy Semantic Mismatch

A compiled Ghost-Ark policy appears safe syntactically but differs from actual AWS/IAM semantics.

Phase B addresses this using formal modeling, model checking, SMT-style reasoning, and differential tests against AWS policy semantics where possible.

### A5: Privacy-Constrained Auditor

An auditor needs proof that a computation complied with policy but must not see the tenant prompt, retrieval context, or proprietary model data.

Phase C addresses this using zk execution receipt interfaces and eventually real zkVM proofs.

### A6: Malicious Log Operator

A log operator attempts to:

- Delete receipt history
- Rewrite checkpoints
- Show different clients different histories
- Backdate events
- Hide unauthorized entries

Phase D addresses this using Merkle checkpoints, consistency proofs, and witness-cosigned logs.

## 4. Phase A: Nitro Enclave Threat Boundary

Phase A protects against host-level and runtime-level compromise by moving sensitive execution into a measured enclave.

### Intended Guarantees

- Secrets are released only to measured enclave code.
- KMS conditions bind decrypt/sign operations to attestation measurements.
- PCR0, PCR1, PCR2, and preferably PCR8 are recorded in manifests.
- Parent host compromise alone should not expose sealed secrets.

### Non-Claims

- Nitro Enclaves do not prove the policy is logically correct.
- Nitro Enclaves do not prove model outputs are safe.
- Nitro Enclaves do not eliminate side-channel risk.
- Nitro Enclaves do not eliminate supply-chain risk before enclave build.
- Nitro Enclaves do not prove that logs are globally consistent.

## 5. Phase B: Formal Policy Verification Threat Boundary

Phase B protects against mistakes in policy semantics, tenant isolation assumptions, and allow/deny logic.

### Intended Guarantees

- Tenant isolation invariants can be stated precisely.
- Policy behavior can be tested against model-checkable specifications.
- Certain classes of cross-tenant access bugs can be found before runtime.
- Supported policy fragments can be differentially tested against external semantics.

### Non-Claims

- A TLA+ model does not prove implementation correctness unless refinement is established.
- Bounded model checking does not prove all possible production behavior.
- A formal model is only as complete as its assumptions.
- Formal policy verification does not prove AI model safety.

## 6. Phase C: zk Execution Receipt Threat Boundary

Phase C protects privacy while allowing public verification of selected computations.

### Intended Guarantees

- A public verifier can check that a specific guest program committed to a specific public journal.
- Private prompts and retrieval context can remain hidden.
- Public journals bind policy hash, decision hash, prompt commitment, and output commitment.
- zk receipts can support compliance verification without disclosing sensitive tenant material.

### Non-Claims

- zk receipts do not prove semantic model safety.
- zk receipts do not automatically support large LLM inference efficiently.
- zk receipts only prove what the guest program actually encoded.
- A bad guest program can still produce a valid proof of bad logic.

## 7. Phase D: Witness-Cosigned Transparency Threat Boundary

Phase D protects against unilateral log rewriting and split-view attacks.

### Intended Guarantees

- Receipts are committed into Merkle roots.
- Checkpoints are signed by one or more witnesses.
- Monitors can detect inconsistent histories.
- Clients can verify checkpoint inclusion and witness signatures.

### Non-Claims

- Transparency does not provide confidentiality.
- Witness signatures do not prove the original decision was correct.
- A single witness is not decentralized.
- Witnesses must be independent to add meaningful assurance.

## 8. Residual Risks

Ghost-Ark still has residual risks even after all phases:

- Supply-chain compromise before build
- Incomplete formal models
- Side channels
- Dependency vulnerabilities
- Prompt injection
- Model hallucination
- Incorrect policy authoring
- Bad assumptions in tenant identity providers
- Misconfigured AWS accounts
- Insider threats among witness operators
- Incomplete monitoring adoption

## 9. Forbidden Claims

Ghost-Ark must not claim:

- It proves AI safety.
- It guarantees safe model behavior.
- It eliminates all risk.
- It is fully trustless.
- It is unbreakable.
- It certifies regulatory compliance by itself.
- It proves truthfulness of model outputs.

## 10. Correct Claim Shape

A correct Ghost-Ark claim should look like:

> Given policy hash H, receipt R, signature S, key manifest K, and checkpoint C, an external verifier can check that R was signed by an allowed key, committed to an append-only checkpoint, and bound to a declared tenant and policy context.

That is the standard: bounded, checkable, and honest.
