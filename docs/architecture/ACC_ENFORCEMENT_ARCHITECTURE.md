# A-CC Enforcement Architecture — Gateway, Severance, Measurement

Status: design document, research-only. Everything in this file is design-stage unless it names a tracked repository artifact. No gateway, severance engine, or effect oracle is claimed as implemented. Decision receipt v1 is unchanged.

This document records the disposition of an external architectural dossier (2026-07-14) proposing the transition path for A-CC enforcement: an intercept gateway, source-signature custody, a context severance engine, an effect oracle, and model checking. The dossier's structural direction is accepted. Several of its technical specifics are corrected below because they would weaken the mechanism or invalidate the evaluation if encoded as proposed.

## Disposition Summary

Accepted: sidecar gateway with network-namespace isolation; replay nonces echoed through tool responses; meet-based delegation admission; DAG-structured context with pruning; TLA+ as the model-checking framework; TRL-4 as a descriptive maturity statement; the Constitutional-AI and IFC positioning, with one correction.

Corrected: signature construction, receipt identity, timestamp semantics, gateway key algorithm, the definition and independence of the efficacy metric, the severance-note contradiction, both proposed TLA+ invariants, the ledger storage recommendation, and the omission of the receipt-v2 dependency from the roadmap.

Refused: ready-for-production framing as a target or destination; a "catch 100%" detection target as claim language; enclave-attestation posture ahead of an implemented, tested AWS-supported flow.

## 1. Intercept Gateway (Rank-1 Mechanism)

Accepted shape: the agent runs in a containerized sandbox with zero direct egress; all outbound traffic exits through a loopback-only sidecar; the sidecar performs the external request, digests the raw response, and returns a signed envelope. This is the mechanism that makes `GATEWAY_RECORDED` a real class instead of a label.

Design constraints that bind any implementation:

- **G1 — Envelope signing, not concatenation.** The dossier proposes `sig(payload_digest || context_id || sequence_num)`. Raw concatenation of variable-length fields creates boundary ambiguity: distinct field tuples can serialize to identical byte strings. Gateway receipts sign a canonical JSON envelope with an exact validated key set, following the decision-receipt precedent in `packages/enforcement-runtime/src/receipts/signer.ts`.
- **G2 — Content-derived identity.** `receipt_id` is derived from the canonical hash of the unsigned envelope (repository convention), not uuid-v7. A content-derived id is self-verifying; a random id is one more field an adversary can decouple from the payload.
- **G3 — Sequence numbers carry order; wall time is advisory.** There is no such thing as an "iso-8601-monotonic" timestamp; wall clocks step and skew. Ordering lives in a per-session monotonic `sequence_num` assigned by the sidecar; the ISO-8601 timestamp is recorded evidence, not an ordering primitive.
- **G4 — Nonce echo.** The sidecar injects a request nonce; the tool response must echo it inside the signed material, binding response to request instance and closing replay of historical signed responses. This extends the existing execution-nonce discipline (`runtime/nonceStore.ts`) to the tool boundary.
- **G5 — Key custody constrains algorithm choice.** The dossier specifies Ed25519. If the gateway key is KMS-custodied — which the repository's signing boundary calls for — the algorithm must come from KMS's supported asymmetric signing set (as of this writing that means ECDSA or RSASSA-PSS families, not Ed25519). Verification-critical key references use immutable key ARNs, never aliases, per the existing rule.
- **G6 — New artifact type, not a v1 mutation.** Gateway receipts are a distinct schema (working name `ghost.gateway_receipt.v1`, design-stage). Binding their digests into decision receipts is the receipt-v2 migration named in docs/research/ACC_DEFENSE_INQUIRIES.md; decision receipt v1 semantics do not change in place.
- **G7 — The sidecar relocates the SSRF problem; it does not dissolve it.** A reverse proxy's DNS-rebinding and confused-deputy exposures move into the sidecar: destination allowlisting, DNS pinning, and redirect handling remain live threat-model rows. The gain is a smaller, single-purpose trusted surface — not the absence of the problem.

Threat rows the gateway addresses, mapped to existing results:

| Attack | Mechanism | Where established |
| --- | --- | --- |
| Agent fabricates a raw "tool response" in-context | Fabricated text carries no gateway envelope; floors above `AGENT_ASSERTED` are unsatisfiable by it (verdict monotonicity, P1) | provenanceLattice.ts, tested |
| Agent executes on a paraphrase of the wrapped receipt (TOCTOU) | The commit predicate evaluates the envelope digests, never the agent's summary; paraphrase divergence is the deterministically checkable A-CC component | ACC_DEFENSE_INQUIRIES.md, Inquiry 9 |
| Replay of a historical signed tool response | Nonce echo (G4) | design-stage |

## 2. Context Severance Engine

Accepted shape: context managed as a DAG; a trajectory failing the commit predicate is pruned; the context is reset to the parent node.

- **S1 — The dossier contradicts itself, and the contradiction matters.** Its transition model states that rejected trajectories leave state unchanged, then instructs appending "Trajectory X attempted and failed Policy P. Do not retry." to the parent. Any appended note is a state mutation; a note carrying trajectory content re-opens the in-context contamination channel the severance engine exists to narrow.
- **S2 — Loop prevention is mechanical, not cognitive.** "Do not retry" in a prompt is a request the model may ignore; enforcement lives at the boundary (enforcement-locus rule). The gate consults a rejected-action digest set — extending the nonce-store pattern — and refuses resubmission of a pruned action deterministically. The model needs no instruction for this to hold.
- **S3 — Marker minimality.** The parent node receives at most a marker containing the pruned trajectory's digest and the policy id — never trajectory content. Corrected transition: on rejection, the successor state is the parent state plus that minimal marker; on acceptance, the state extends with the evidence and policy binding.
- **S4 — Residual influence is measured, not claimed away.** Whatever leaks through the minimal marker and the model weights is the population flip-rate Δ estimand (paired trials, confidence intervals). No zero-contamination statement is available for the in-context channel.

## 3. Measurement: Two Metrics, Not One

- **M1 — The dossier's redefinition of M is circular and is rejected.** It has the "Effect Oracle" query the Ghost-Ark receipt ledger and compare it against the agent's claims. That makes Ghost-Ark the measurement instrument for Ghost-Ark: the defendant grading its own verdicts. Efficacy numbers produced that way are inadmissible.
- **M — certified-compromise rate.** M = P(SAFE = 0 | CR = 1): the fraction of receipt-valid executions in which an *independent* effect oracle — a dumb recording proxy in front of all effect targets during benchmark runs, sharing no code or state with Ghost-Ark — observed an unauthorized durable effect under pre-registered labels. M is the efficacy metric. It does not exist without the independent oracle.
- **D — assertion-vs-record divergence rate.** Ledger-computable: the agent's claimed outcome contradicts the recorded commit. Valuable as a runtime monitor and as the receipt-v2 detection target; invalid as efficacy evidence, because it is self-referential.
- **Reporting discipline.** Detection and containment results are reported as measured rates with confidence intervals on stated workloads. A "catches 100%" formulation is refused as claim language; if a benchmark run observes zero misses, the report states the observed count and the coverage bounds of the workload, nothing stronger. The pre-registered prediction from the GhostBench plan stands: containment sensitivity should be indistinguishable with receipts enabled versus disabled; the receipt mechanism's expected marginal contribution is auditability (D, and post-hoc attribution), not containment.

## 4. Reference-Architecture Corrections

- **Ledger storage.** Amazon QLDB reached end of support in mid-2025 and is not a candidate. The ledger design remains DynamoDB for the receipt chain with S3 Object Lock checkpoint bundles, per the existing target architecture.
- **Enclaves.** TEE execution stays in the aspirational lane. Per the repository's AWS reality boundary, no enclave or attestation posture is stated until an AWS-supported attestation flow is implemented and tested.
- **Tool-source key registry.** A transparency-log registry (Sigstore-style) for `Tool_ID → public key` is a legitimate research direction; the nearer-term registry is KMS with immutable key ARNs and the existing key-manifest epoch checks (`receipts/keyManifest.ts`).
- **Key-theft drill (accepted, sharpened).** The simulated-compromise exercise must verify attribution, not detection: a payload signed with a stolen source key *should* verify at `SOURCE_SIGNED` — the test passes when the compromise is attributable to that key custodian and when `CROSS_WITNESSED` floors remain unsatisfied by the single stolen key. The conflicting-witness drill already has a tested kernel: `deriveAggregateClass` rejects digest disagreement (provenanceLattice tests).

## 5. Formal Model Status

`proofs/tla/ProvenanceLattice.tla` and `ProvenanceLattice.cfg` model the rank chain, meet-based delegation admission, and floor evaluation, alongside the existing `TenantIsolation` stub.

- **F1 — The dossier's delegation invariant is half the property.** It requires only `Rank(e) <= ReverifiedRank(e)`. Without the claimed-class bound the admitted rank could exceed the claim, which is not the meet. The model states both conjuncts: admitted rank is bounded by claimed and by re-verified.
- **F2 — The dossier's "P1" invariant is a different property than P1.** `ActionEvidenceRank(action) >= PolicyFloor(action)` is premise soundness (every committed action met its floor). Verdict monotonicity (P1) is the flood property: below-floor additions never change the qualifying set. The model states them separately — `SatisfiedStable` and `FloodImmunity` as action properties, floor satisfaction as a state predicate — because conflating them produces a vacuous check.
- **Status.** Checked on 2026-07-14 with TLC 2.19: the baseline run reports no invariant or property violation over 403,949 distinct states — matching the expectation pre-registered in proofs/tla/README.md before the run — and the mutant run (`ProvenanceLatticeMutant.tla`, permitting direct assignment of the derive-only rank) reports the prescribed `NoDeriveOnlyAssignment` violation. Artifacts: `proofs/tla/artifacts/ProvenanceLattice.tlc.txt` and `proofs/tla/artifacts/ProvenanceLatticeMutant.tlc.txt`. This validates the finite abstraction only; the refinement boundary in FORMAL_METHODS_NOTES.md applies unchanged.

## 6. Corrected 12-Month Sequence

The dossier's ordering places measurement after mechanism and omits the receipt-v2 dependency entirely. Corrected sequence with rationale:

| Months | Work | Why this position |
| --- | --- | --- |
| 1–3 | Sidecar gateway + namespace isolation (constraints G1–G7) | Everything downstream depends on Rank 1 existing as a mechanism |
| 3–4 | TLC checking of ProvenanceLattice + mutants; extend model with derivation | The model is small; checking it is cheap and specifies what the sidecar implements |
| 4–6 | Gateway-receipt schema + receipt-v2 design (tool I/O digest binding, migration path) | The dossier skips this; without it, divergence detection (D) has no committed record to diverge from |
| 6–9 | Independent Effect Oracle + FSA corpus + pre-registered GhostBench run | Measurement precedes mechanism claims; the oracle must exist before severance lands so severance is evaluated, not assumed |
| 9–12 | Context severance engine (S1–S4) evaluated against the oracle; report M, D, Δ with CIs | The engine's value is an empirical question the oracle answers |

## 7. Positioning Corrections

- **Information-flow control.** The dossier frames Ghost-Ark as tracking where data came from versus IFC's where data goes. The repository already does both directions: forward taint (retrieval risk tags and quarantine in `retrieval/filter.ts` and the governed-invoke taint gates) and backward provenance (the lattice floors). Related-work text must say so; reviewers will notice otherwise.
- **Constitutional AI.** The contrast is accepted as positioning: behavioral alignment is probabilistic; boundary pricing of forgery cost is deterministic under stated assumptions. It is a difference in kind, not a superiority claim — the two compose.
- **Maturity.** TRL 4 is accepted as description. The target state is named as a reviewer-grade evidence prototype with live AWS evidence — not by ready-for-production language, which the claim policy forbids and this document refuses.

## Non-Claims

- No gateway, severance engine, oracle, or benchmark exists yet; this file is design except where it cites tracked artifacts.
- The TLA+ model is unchecked; no model-checking result is claimed until a checker artifact exists.
- Nothing here states detection of semantic falsehood in source-reported content (Impossibility I2).
- No safety, alignment, compliance, deployment-correctness, attestation, or readiness claim is made or implied.
- Metric definitions are benchmark estimands, not field rates.
