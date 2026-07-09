Ghost-Ark Frontier Threat Model

Purpose

Ghost-Ark is a verifiable AI infrastructure architecture. Its purpose is to make bounded execution, policy, provenance, receipt, discretization, audit, and verification claims independently checkable.

This threat model defines:

* what Ghost-Ark protects
* which adversaries it considers
* which research frontier phase addresses each threat
* which trust boundaries remain
* which claims remain forbidden

This document is not a production security certification, compliance assessment, AI safety proof, or claim that every listed control has been implemented.

Claim Boundary

All claims in this threat model are governed by:

docs/research/ASSURANCE_MATURITY_LADDER.md
docs/research/CLAIM_EVIDENCE_MATRIX.md
docs/research/RESEARCH_FRONTIER_ROADMAP.md

A threat described here is not automatically mitigated. A mitigation is claimable only at the maturity level supported by implemented evidence, tests, cloud validation, external verification, independent witness confirmation, or formal proof artifacts.

1. Protected Assets

Ghost-Ark protects or intends to protect the following assets:

* tenant identity
* tenant namespace boundaries
* tenant-scoped resources
* policy decisions
* policy versions and hashes
* prompt commitments
* retrieval access boundaries
* memory access boundaries
* consent-gated memory records
* guardrail score observations
* discretization rule receipts
* CC-compatible binary observations
* decision receipts
* KMS signature provenance
* signing key identity
* receipt hash chains
* Merkle checkpoint roots
* evidence bundles
* external verification bundles
* attestation measurements
* zk execution receipt journals
* witness-cosigned checkpoint records
* claim envelopes
* non-claim boundaries

2. Core Security and Assurance Properties

Ghost-Ark aims to preserve the following properties, each under its own maturity boundary.

Tenant Isolation

A request from Tenant A must not access resources belonging to Tenant B.

Policy Integrity

The runtime must evaluate the intended policy version and must not silently downgrade, bypass, or replace the policy.

Receipt Integrity

A decision receipt must bind the decision, tenant context, policy hash, model identity, canonical payload, and signature metadata.

Key Integrity

Signing and decryption keys must not be usable outside authorized execution contexts.

Log Integrity

Receipt history should be append-only, checkpointed, and externally verifiable where the required evidence exists.

Discretization Integrity

A continuous, stochastic, or textual guardrail output must not become a CC-compatible binary variable unless the score domain, threshold, comparator, calibration digest, scoring digest, validity window, and parent lineage are receipt-bound.

Claim Integrity

The project must not claim more than its evidence supports.

3. Trust Boundaries

Ghost-Ark must distinguish the following trust boundaries.

Boundary	Trusted only if	Not trusted for
Client request body	Validated and stripped of authority-bearing fields	Tenant identity, user identity, policy authority
Cognito or authorizer context	Verified by deployed API configuration	Semantic correctness of user intent
Policy repository	Versioned and hash-bound	Correctness of policy authoring
Runtime handler	Tested and monitored under stated conditions	Protection against full host compromise
KMS signer	Key identity and signature verification are checked	Truth or safety of signed payload
Receipt store	Append or update rules are enforced and verified	Semantic validity of receipt contents
Witness key	Key manifest and signature verification pass	Independence unless externally controlled
Formal model	Checked for stated configuration and invariant	Implementation correctness without refinement
zk receipt	Verifier accepts stated proof relation	Safety of logic not encoded in the guest
CC-Framework input	Discretization provenance and assumptions are present	Validity of upstream score or threshold choice

4. Adversary Classes

A1: Malicious Tenant

A malicious tenant attempts to:

* override tenant identifiers in request bodies
* access another tenant’s memory
* access another tenant’s receipts or evidence
* forge receipt payloads
* reuse stale receipts
* abuse model invocation paths
* trigger policy parser edge cases
* exploit retrieval or memory namespace confusion

Primary controls:

* tenant identity from trusted authorizer context
* rejection of client-declared tenant authority
* tenant-scoped paths and partition keys
* decision receipts
* tenant-bound verifier checks
* formal tenant-isolation model stubs

A2: Compromised Application Runtime

An attacker gains control over part of the application runtime and attempts to:

* bypass policy checks
* modify decision receipts before signing
* swap model identifiers
* disable audit emission
* inject unsafe environment variables
* redirect receipt writes
* suppress failures
* alter discretization thresholds before observation emission

Primary controls:

* fail-closed policy paths
* signed receipts
* minimized receipt payloads
* KMS-backed signing
* canonical payload digests
* verification CLI
* future enclave attestation
* claim-boundary scanner

A3: Compromised Cloud Host

An attacker controls the parent EC2 host or privileged cloud-side execution environment and attempts to:

* extract secrets
* inspect plaintext prompts
* tamper with policy execution
* modify LLM invocation behavior
* forge evidence of correct execution
* sign receipts outside the intended measured runtime

Phase A addresses this using Nitro Enclave attestation and KMS attestation-bound key release.

A4: Policy Semantic Mismatch

A compiled Ghost-Ark policy appears safe syntactically but differs from intended semantics or from supported AWS/IAM semantics.

The attacker or bug attempts to exploit:

* ambiguous deny precedence
* policy compiler bugs
* tenant namespace derivation mistakes
* unsupported IAM condition behavior
* mismatch between local model and cloud behavior

Phase B addresses this using formal modeling, model checking, SMT-style reasoning, and differential tests against AWS policy semantics where possible.

A5: Privacy-Constrained Auditor

An auditor needs proof that a computation complied with policy but must not see the tenant prompt, retrieval context, memory contents, or proprietary model data.

Phase C addresses this using zk execution receipt interfaces and eventually real zkVM proofs.

A6: Malicious Log Operator

A log operator attempts to:

* delete receipt history
* rewrite checkpoints
* show different clients different histories
* backdate events
* hide unauthorized entries
* equivocate across tenants or auditors

Phase D addresses this using Merkle checkpoints, consistency proofs, and witness-cosigned logs.

A7: Discretization Manipulator

An attacker attempts to manipulate the bridge from Ghost-Ark evidence into CC-Framework analysis by:

* changing thresholds after observing scores
* flipping comparator direction
* omitting calibration context
* mixing score versions within one cohort
* using 1 to mean pass in one system and failure in another
* pooling observations across non-stationary windows
* hiding parent execution lineage
* presenting naked binary labels to CC-Framework

Phase 2 addresses this using the CC-Ghost discretization contract.

Primary controls:

* signed discretization rule receipt
* bounded score domain
* explicit score polarity
* monotonic risk invariant
* failure semantics fixed to 1 means guardrail failure or unsafe pass
* calibration digest
* scoring function digest
* validity window
* parent trace digest
* copula stationarity declaration
* binary observation verifier

A8: Claim Inflation Adversary

A maintainer, marketer, contributor, or downstream user intentionally or accidentally overstates what Ghost-Ark proves.

Examples:

* calling a schema a proof
* calling local dev witness signatures decentralized transparency
* calling a smoke run production readiness
* calling receipt integrity evidence truth
* calling formal model stubs implementation verification
* calling zk interfaces real zk execution
* calling AWS scaffolding enterprise-grade security

Primary controls:

* assurance maturity ladder
* claim evidence matrix
* forbidden-claim scanner
* non-claim registry
* reviewer rule
* public wording rules

5. Phase A: Nitro Enclave Threat Boundary

Phase A protects against host-level and runtime-level compromise by moving selected sensitive operations into measured enclave code.

Intended guarantees after implementation

* Secrets are released only to measured enclave code.
* KMS conditions bind decrypt or sign operations to attestation measurements.
* PCR0, PCR1, PCR2, and preferably PCR8 are recorded in manifests.
* Parent host compromise alone should not expose enclave-sealed secrets under the stated threat model.
* Attestation documents can be parsed and verified against expected measurements.

Non-claims

* Nitro Enclaves do not prove the policy is logically correct.
* Nitro Enclaves do not prove model outputs are safe.
* Nitro Enclaves do not eliminate side-channel risk.
* Nitro Enclaves do not eliminate supply-chain risk before enclave build.
* Nitro Enclaves do not prove logs are globally consistent.
* Nitro Enclaves do not prove AWS itself is correct.
* Nitro Enclaves do not imply production readiness.

Claim gate

No Nitro claim may exceed L2 until there is a real enclave build artifact or parser evidence.

No Nitro runtime security claim may exceed L5 without live AWS attestation evidence.

6. Phase B: Formal Policy Verification Threat Boundary

Phase B protects against mistakes in policy semantics, tenant isolation assumptions, and allow/deny logic.

Intended guarantees after implementation

* Tenant-isolation invariants can be stated precisely.
* Policy behavior can be tested against model-checkable specifications.
* Certain classes of cross-tenant access bugs can be found before runtime.
* Supported policy fragments can be differentially tested against external semantics.

Non-claims

* A TLA+ model does not prove implementation correctness unless refinement is established.
* Bounded model checking does not prove all possible production behavior.
* A formal model is only as complete as its assumptions.
* Formal policy verification does not prove AI model safety.
* Formal policy verification does not prove AWS IAM, Cognito, Lambda, DynamoDB, KMS, Bedrock, OpenSearch, or S3 correctness.

Claim gate

No formal-methods claim may exceed L2 unless the model and configuration are tracked.

No formal-methods claim may be called checked unless a TLC, Apalache, SMT, proof-assistant, or equivalent output artifact is present.

No implementation correctness claim is allowed without a refinement argument.

7. Phase C: zk Execution Receipt Threat Boundary

Phase C protects privacy while allowing public verification of selected governance computations.

Intended guarantees after implementation

* A public verifier can check that a specific guest program committed to a specific public journal.
* Private prompts and retrieval context can remain hidden under the stated commitment scheme.
* Public journals bind policy hash, decision hash, prompt commitment, and output commitment.
* zk receipts can support selected policy-computation verification without disclosing sensitive tenant material.

Non-claims

* zk receipts do not prove semantic model safety.
* zk receipts do not automatically support large LLM inference efficiently.
* zk receipts only prove what the guest program actually encoded.
* A bad guest program can still produce a valid proof of bad logic.
* zk proof verification does not prove production privacy unless the full data-flow and side-channel boundary are covered.

Claim gate

No zk claim may exceed L2 until real proof artifacts or verifier adapters exist.

No zk proof claim may reach L8 without proof artifacts, public inputs, verifier implementation, and reproduction instructions.

8. Phase D: Witness-Cosigned Transparency Threat Boundary

Phase D protects against unilateral log rewriting and split-view attacks.

Intended guarantees after implementation

* Receipts are committed into Merkle roots.
* Checkpoints are signed by one or more witnesses.
* Monitors can detect inconsistent histories.
* Clients can verify checkpoint inclusion and witness signatures.
* Independent witnesses can constrain unilateral operator equivocation.

Non-claims

* Transparency does not provide confidentiality.
* Witness signatures do not prove the original decision was correct.
* A single witness is not decentralized.
* A maintainer-controlled witness is not independent.
* Local dev witness signatures are not independent witness confirmation.
* Transparency does not prove AI safety, compliance, or deployment correctness.

Claim gate

No witness transparency claim may be described as independent, decentralized, or externally monitored without L7 evidence.

9. Attack-to-Control Matrix

Adversary	Primary risk	Current or planned controls	Highest safe claim before stronger evidence
A1 malicious tenant	Cross-tenant access	trusted tenant context, tenant-bound paths, verifier checks, formal stub	Locally tested tenant-boundary behavior only
A2 compromised runtime	Receipt or policy bypass	signatures, canonical digests, fail-closed paths, future enclaves	Receipt integrity for signed artifacts
A3 compromised host	Secret extraction or execution tampering	Nitro Enclave attestation, KMS attestation-bound release	Research/design until real enclave evidence
A4 policy mismatch	Policy semantics bug	formal models, differential tests	Model-bound or checked only for stated fragments
A5 privacy-constrained auditor	Need proof without plaintext	zk receipt interface, commitments	Schema/interface only until real proofs
A6 malicious log operator	Rewriting or split-view logs	Merkle checkpoints, witnesses, monitors	Local verifier mechanics until independent witnesses
A7 discretization manipulator	Invalid CC variables	signed discretization rules, monotonic invariant, calibration digest	Contract-level until verifier and CC adapter exist
A8 claim inflation	Overstated public claims	maturity ladder, claim matrix, scanner	Claim-boundary controls for known patterns

10. Residual Risks

Ghost-Ark still has residual risks even after all phases:

* supply-chain compromise before build
* incomplete formal models
* side channels
* dependency vulnerabilities
* prompt injection
* model hallucination
* incorrect policy authoring
* bad assumptions in tenant identity providers
* misconfigured AWS accounts
* runtime bugs outside modeled behavior
* insider threats among witness operators
* incomplete monitoring adoption
* calibration drift
* threshold gaming
* dataset shift
* non-stationary guardrail dependence
* private evidence that cannot support public claims

11. Forbidden Claims

Ghost-Ark must not claim:

* it proves AI safety
* it guarantees safe model behavior
* it proves semantic truthfulness of model outputs
* it eliminates all risk
* it is fully trustless
* it is unbreakable
* it certifies regulatory compliance by itself
* it proves deployment correctness
* it provides production readiness by default
* it has decentralized transparency without independent witnesses
* it has formal verification without reproducible proof or checker artifacts
* it has zero-knowledge execution without real proof artifacts
* it has enclave-backed execution without real enclave evidence

12. Correct Claim Shape

A correct Ghost-Ark claim should look like:

Given policy hash H, receipt R, signature S, key manifest K, and checkpoint C, an external verifier can check that R was signed by an allowed key, committed to a stated checkpoint, and bound to a declared tenant and policy context under Ghost-Ark verifier rules.

A correct CC-Ghost bridge claim should look like:

Given score observation O, discretization rule receipt D, threshold tau, comparator bowtie, calibration digest C, scoring digest M, and parent trace P, a verifier can check that the binary variable Z_i was produced according to the declared receipt-bound rule before CC-Framework consumes it.

Both claims are bounded, checkable, and honest.

Final Boundary

Ghost-Ark is not a magic trust layer.

It is an evidence-bound infrastructure project.

Its value comes from making narrow claims independently checkable while refusing to convert receipts, signatures, schemas, tests, smoke runs, formal stubs, or proofs into broader claims than they support.