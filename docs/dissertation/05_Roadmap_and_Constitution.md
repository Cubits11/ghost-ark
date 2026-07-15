## PART VII — REPOSITORY EVOLUTION PLAN

To achieve USENIX artifact evaluation readiness, the repository must be strictly partitioned to reflect the trust boundaries.

**Target Structure:**
- `packages/dab-runtime`: The untrusted Node.js/TypeScript execution bindings.
- `schemas/dab`: Language-agnostic JSON Schemas for receipts and DANF.
- `proofs/dab`: TLA+ and formal verification models for the ReplayLedger.
- `research/dab`: Extended evaluation metrics and security proofs.
- `tests/dab`: Integration and unit tests validating invariant $\Delta_{\text{DE}} = 0$.
- `artifacts/dab`: Sample signed receipts for offline verifier testing.
- `tools/dab`: Offline Rust verifier.

## PART VIII — ENGINEERING ROADMAP

- **30-Day Plan**: Extract DAB from `packages/` into its own isolated `dab/` root. Achieve 100% unit test coverage on `verifier.rs` and `danf.ts`.
- **90-Day Plan**: Integrate an external durable store (Redis/DynamoDB) for the `NonceLedger` to survive gateway restarts.
- **6-Month Plan**: Implement TLA+ formal verification of the Replay Ledger. Publish the initial formal model.
- **12-Month Plan**: Hardware isolation. Move the Rust Gateway into an AWS Nitro Enclave to completely remove the host OS from the TCB.

## PART IX — DISSERTATION QUALITY CONTRIBUTIONS

**Contribution 1: Deterministic Action Normal Form (DANF)**
- **Novelty**: Shifts serialization trust from the host language to a language-agnostic byte-commitment protocol.
- **Evaluation Strategy**: Fuzz testing cross-language serialization collisions.

**Contribution 2: The $\Delta_{\text{DE}}$ Invariant**
- **Novelty**: Formally defining the delta between agent intent and physical execution bytes, and enforcing $\Delta_{\text{DE}} = 0$ as a hard cryptographic invariant.


## PART X — FINAL ARCHITECTURAL COMMANDMENT

### The Ghost-Ark/DAB Research Constitution

1. **NEVER confuse what an agent intended with what an agent executed.** Intent is a semantic hallucination. Execution is a physical reality backed by cryptographic bytes.
2. **NEVER confuse design with implementation.** An architecture diagram is not a security boundary; only the compiled Rust TCB and IPC socket are security boundaries.
3. **NEVER confuse implementation with evidence.** Code execution means nothing without a cryptographically signed Receipt.
4. **NEVER confuse evidence with proof.** A Receipt proves what was executed, not that the execution was morally good or safe.
5. **NEVER confuse a benchmark with a formal assurance.** Benchmarks track regressions; only formal TLA+ models and mathematical invariants provide target security bounds.
