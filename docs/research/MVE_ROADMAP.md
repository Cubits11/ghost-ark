# Minimum Viable Epistemology (MVE) — Phase I–IV Roadmap

Status: research roadmap, research-only. This sequences what Ghost-Ark must establish before any claim about governed agent execution is admissible. Each phase names an epistemic capability, the artifact that earns it, and the non-claim that survives it. Phases are ordered so that no phase depends on evidence a later phase produces.

The MVE question: what is the least a reviewer who trusts neither the author, the README, nor the model must be able to independently check for a Ghost-Ark decision to carry weight? The four phases answer it in dependency order.

## Phase I — The Deterministic Gate

Capability: enforcement lives in code at the effect boundary, never in the model's context window, and the same inputs always produce the same gate decision.

Artifacts (largely in place):
- Fail-closed governed-invoke pipeline (`runtime/governedInvoke.ts`): every gate failure, dependency failure, or receipt-emission failure withholds the effect.
- Deterministic canonicalization that rejects host-language non-JSON values before hashing (`receipt-schema/src/hashCanonicalization.ts`) — the hardening an NPM stable-stringify would silently undo.
- Execution-nonce replay resistance (`runtime/nonceStore.ts`).
- Intercept-gateway reference: digest the bytes that actually crossed the wire, label them GATEWAY_RECORDED, allowlist destinations, fail closed (`gateway/sidecarProxy.ts`).

Exit criterion: determinism is testable — identical inputs yield byte-identical canonical payloads and identical decisions across runs.

Non-claim: a deterministic gate is not a correct gate; it is a reproducible one. Determinism enables audit, it does not establish safety.

## Phase II — Verifiable Receipts

Capability: an independent party recomputes a decision's identity, canonical digest, and signature binding from the receipt alone, without importing Ghost-Ark code.

Artifacts:
- `ghost.receipt.v1` schema, canonical digest, signature envelope (in place).
- Node-builtins-only independent verifier and stdlib-only Python verifier (in place; Receipt Truth Ladder L6).
- Receipt v2 (this exchange, DRAFT): adds `execution_trace` binding per-tool-call transit digests so assertion-vs-record divergence becomes receipt-detectable. Prototype emission + independent v2 verifier parity: `receipts/v2/emission.ts`, `verifiers/node/ghost_receipt_v2_verify.mjs`.

Exit criterion: a second implementation agrees with the primary on identity, digest, and signature for both a valid corpus and a malicious corpus, for v1 and v2.

Non-claim: a verifiable receipt binds signing authority to a payload; it does not endorse the payload. A signed receipt of a compromised execution is a confession, not a warrant (ACC_DEFENSE_INQUIRIES.md, Inquiry 2).

## Phase III — Effect Oracles

Capability: measure what actually happened in the world, independently of Ghost-Ark's own records, so efficacy is not self-certified.

Artifacts (to build):
- An Effect Oracle: a dumb recording proxy in front of every effect target during benchmark runs, sharing no code or state with Ghost-Ark.
- GhostBench FSA corpus: tasks seeded with Function-Sourced Assertions (tools that lie).
- The certified-compromise rate M = P(SAFE = 0 | CR = 1): receipt-clean executions the oracle shows were unsafe. M is undefined without the independent oracle (Inquiry 7).

Exit criterion: M, its dual over-blocking rate, and the assertion-vs-record divergence rate D are reported with confidence intervals on the pre-registered corpus, with the receipts-enabled vs receipts-disabled containment prediction registered before the run.

Non-claim: benchmark rates are estimands on stated workloads, not field safety rates. The oracle measures durable effects, not semantic truth.

## Phase IV — Epistemic Hardening

Capability: the checkable properties are checked by more than assertion — finite models machine-checked, mutants proving the invariants bite, adversarial corpora proving fail-closed behavior.

Artifacts (partially in place):
- TLA+ models with recorded TLC artifacts and load-bearing mutants: TenantIsolation (stub), ProvenanceLattice (checked, 403,949 states), SpeculativeCollapse (checked, claim-trusting mutant refuted).
- Malicious receipt corpus with expected fail-closed verdicts (in place).
- Refinement layer connecting model actions to implementation traces (to build) — the current honest gap between checked abstraction and running code.

Exit criterion: every "we check X" claim cites either a recorded checker artifact or a passing adversarial corpus; the refinement boundary between model and implementation is documented, not blurred.

Non-claim: a checked finite model validates an abstraction, not the deployment. Formal methods are powerful only when the claim is exact (FORMAL_METHODS_NOTES.md).

## Dependency Order

Phase III depends on Phase I (a gate to measure) and Phase II (receipts whose divergence from oracle records is the measurement). Phase IV hardens I–III but produces no capability they lack. Attempting III before II gives you numbers with no independent recomputation; attempting IV before I gives you proofs about a gate that does not fail closed. The order is not stylistic.

## Non-Claims (roadmap-level)

- The MVE establishes what is checkable, not what is safe, aligned, compliant, or deployment-ready.
- No phase claims semantic-truth detection; that is Impossibility I2 throughout.
- Artifact existence is not artifact sufficiency; each exit criterion is a floor, not a certificate.
