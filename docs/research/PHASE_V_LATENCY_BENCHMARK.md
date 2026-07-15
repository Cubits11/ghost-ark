# Phase V Latency Benchmark — Speculative Collapse vs Synchronous Gating

Status: experimental protocol, research-only. No performance measurement has been run. Nothing here claims speculation is faster; that is the question, not the premise.

## Correction to the mandate

The commissioning directive asked this benchmark to "prove that the fork-and-merge approach is strictly faster than synchronous gating." That framing is refused. An experiment whose conclusion is fixed in advance is not an experiment, and "strictly faster" across all workloads is almost certainly false: floor evaluation over the provenance lattice is microseconds of hashing and comparison, while any fork mechanism costs more than that. The protocol below pre-registers the hypothesis, the decision rule, and — explicitly — the conditions under which speculation loses.

A second correction. The directive routes the speculative "dream" thread's tool calls to "mock/ephemeral endpoints," in the same document that bans mocks as epistemological poison. It is right to ban them: a dream thread reasoning over fabricated tool responses produces a trajectory conditioned on data that never existed, and flushing its queued effects after verification commits actions derived from fiction. The design constraint adopted here instead:

- **Dream reads are real.** Speculative tool reads transit the actual gateway and are recorded like any transit (each pending its own floor).
- **Dream writes are deferred.** External effects queue in the deferred-effect buffer; nothing egresses during speculation.
- **Collapse is conjunctive.** The buffered effects flush only if every evidence element in the speculative trace satisfies its floor — the rule modeled in proofs/tla/SpeculativeCollapse.tla and implemented by SpeculativeContextManager.commitSpeculation.

## Hypothesis (pre-registered)

H1: speculative collapse reduces end-to-end wall-clock latency relative to synchronous gating if and only if the verification latency it overlaps exceeds the speculation overhead:

- T_sync = T_reason + T_verify + T_effect
- T_spec = T_reason + T_fork + max(T_verify − T_overlap, 0) + T_effect + p_abort × T_wasted

where T_overlap is speculative work performed during verification, p_abort the abort rate, and T_wasted the discarded speculative compute. Speculation is predicted to LOSE where T_verify is small (local floor evaluation) and to win where T_verify is large (network verification, multi-witness collection, human review).

## Conditions

Verification-latency tiers (the independent variable):

| Tier | Verification path | Expected T_verify | Pre-registered expectation |
| --- | --- | --- | --- |
| V0 | Local floor evaluation (provenanceLattice) | microseconds | speculation loses; fork overhead dominates |
| V1 | Signature verification via KMS round-trip | milliseconds | near crossover; direction unknown |
| V2 | Cross-witness collection, k-of-n independent sources | tens to hundreds of ms | speculation likely wins |
| V3 | Human-review gate | minutes | speculation wins if aborts are cheap |

Fork-mechanism tiers (the platform variable):

| Tier | Mechanism | Scope |
| --- | --- | --- |
| F0 | In-process canonical clone (SpeculativeContextManager) | semantic overhead only; measurable in this repository today |
| F1 | Process snapshot (CRIU/userfaultfd) | Linux-only; design target, not measurable on the macOS dev host |
| F2 | microVM snapshot (Firecracker) | Linux/KVM-only; design target |

The directive's "< 5ms snapshot" figure is a target to be measured at F1/F2, not an assumption. No number from F1/F2 exists yet and none is claimed.

## Metrics and decision rule

1. **Latency delta.** Median and p95 of T_spec − T_sync per (V-tier × F-tier) cell, ≥ 100 paired trials per cell, reported with bootstrap confidence intervals. Speculation is adopted for a cell only if the 95% CI of the median delta lies entirely below zero.
2. **Overhead ratio.** T_fork / T_verify per cell — the a-priori predictor H1 says should determine the sign.
3. **Containment equivalence (gate, not metric).** On the FSA corpus, the flushed effect set under speculation must be identical to the synchronous baseline's effect set in every trial — same effects, same refusals. Any divergence disqualifies the cell regardless of latency: a faster pipeline that changes containment outcomes is not an optimization, it is a different (and unevaluated) enforcement system.
4. **Abort-rate sensitivity.** Report p_abort per cell and the latency delta as a function of injected abort rates {0%, 10%, 50%}; speculation's advantage must survive realistic abort rates, not just the happy path.

## Contamination accounting

Process-level severance makes the canonical thread's in-context contamination zero by mechanism — the canonical state never contained the speculative content, which is stronger than prompt-level pruning. Two channels remain and are measured, not assumed away: the abort-marker channel (markers carry digests only; verified by inspection of marker contents) and the deferred-effect buffer (must be empty after abort; verified by the effect oracle). The dream thread's own contamination is irrelevant after SIGKILL only if both channels are clean.

## Non-claims

- No latency result exists; this document is protocol only.
- Speculation is not claimed to be faster; V0 is pre-registered as a predicted loss.
- The F0 manager provides collapse semantics, not isolation; nothing here claims process or memory isolation.
- Containment equivalence is a benchmark gate on stated workloads, not a field-safety statement.
