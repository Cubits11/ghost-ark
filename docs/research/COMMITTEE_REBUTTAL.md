# Response to the Joint USENIX/OSDI Program Committee Referees

> **Provenance note (repository-internal).** This letter is a rehearsal artifact: it responds to the adversarial-committee audit rounds recorded in this repository, and the venue framing is illustrative. It is retained because every factual claim below is bound to committed evidence paths that a skeptical reader can replay (`scripts/run-proofs.sh`, `make attack`). Claims are stated with their bounds; open items are disclosed as open.

We thank the reviewers for their rigorous and insightful critique of the Ghost-Ark architecture. This letter addresses the specific concerns raised during the evaluation pipeline: namely, the nomenclature, the liveness properties under concurrent verification, and the completeness of our TLA+ safety proofs.

---

### Critique 1: Overloaded Nomenclature and Epistemic Bounding
*Referees noted that the initial manuscript relied on metaphorical nomenclature ("Living Metal," "Quantum Shielding") that obscured the system's core technical contribution.*

**Response:**
We have revised the paper's theoretical framework to strip away non-academic terminology. Ghost-Ark is now modeled as a **Software Transactional Memory (STM) primitive for non-deterministic (stochastic) execution processes**.

By mapping database isolation levels to LLM context boundaries, we show that standard agent pipelines suffer from the "Dirty Write Anomaly" (where uncommitted hallucinations mutate physical systems), while traditional sandboxes suffer from "Write Skew/Phantom Reads" (where reasoning is constructed on stale reads). Ghost-Ark specifies a **Serializable** execution model where a speculative trajectory $\tau = \langle a_1, \dots, a_n \rangle$ runs entirely within a ghost replica $G(\sigma_0)$ and is only committed after passing low-level and high-level verification. This mapping is formalized in the repository at [STM_ISOLATION_MAPPING.md](STM_ISOLATION_MAPPING.md).

---

### Critique 2: Formal Verification Inconsistencies and the Replay Vulnerability
*Referees identified syntax errors and a severe safety violation in `DAB_NonceLedger.tla` where the `GarbageCollect` action allowed nonces to be reused, breaking the `NoReplays` invariant (Blocker #1 and #2 from the audit).*

**Response:**
We acknowledge this critical catch, and we record what was true, what was repaired, and what remains open.

1. **Syntax.** The LaTeX operator (`\setminus` where TLA+ set-difference is `\`) is corrected in both the baseline and the TOCTOU mutant; both specifications now parse under TLC.
2. **The violation was a true positive.** With only the operator corrected, TLC refuted `NoReplays` (169 distinct states): `GarbageCollect` forgot consumed nonces, permitting re-consumption. The specification now models a `spent` tombstone set — garbage collection archives nonces instead of forgetting them — and consumption requires
$$ n_i \notin \mathcal{L}_{nonce} \quad \text{and} \quad n_i \notin S_{spent} $$
An explicit `Terminating` step was added so TLC's deadlock check covers the scenario's intended terminal state instead of flagging it.
3. **Verification is recorded, not asserted.** TLC was re-run on the corrected specification: `NoReplays` (safety) and `EventualGC` (liveness) hold over the complete bounded state space of the checked configuration (3 agents, 5 nonces, `MaxLedgerSize = 3`; 1,321 distinct states). The TOCTOU mutant still violates `NoReplays` (counterexample reached within 232 distinct states), confirming the invariant is not vacuous. Committed logs: `proofs/dab/artifacts/DAB_NonceLedger.tlc.txt` and `proofs/dab/artifacts/DAB_NonceLedger_Mutant.tlc.txt`; regenerate with `scripts/run-proofs.sh`. The corrected specification is checked in at [DAB_NonceLedger.tla](../../proofs/dab/DAB_NonceLedger.tla).

**Previously open, now closed:** the Rust implementation (`dab/gateway/src/nonce.rs`) previously evicted nonces by TTL without tombstones, creating a post-TTL replay window. The implementation now mirrors the verified TLA+ model: `consume()` checks both the active `entries` map and a `spent` tombstone HashSet; `cleanup_expired()` archives evicted nonces into `spent` rather than forgetting them. A nonce consumed at time T is now rejected at T+3601. **Bounded caveat (stated, not hidden):** the in-process `spent` set is bounded at 500,000 entries. When this limit is reached, oldest tombstones are pruned, opening a theoretical bounded-replay-window for nonces older than both the TTL and the tombstone capacity. Production deployments should use a durable external store. This caveat is documented in `docs/artifact/repository_inventory.md` §7.2.

---

### Critique 3: The Starvation Trap and Liveness under Concurrent Verification
*Referees raised concerns that checking global environment state ($\mathcal{H}(\sigma_{now}) == \mathcal{H}(\sigma_0)$) would cause extreme transaction starvation under concurrent workloads, making the system practically unusable.*

**Response:**
To preserve liveness while enforcing serializability, we specify a **Read-Set Projection Operator ($\pi_R$)** in the validation phase. Instead of checking the global state, the Gateway Reference Monitor projects the state check onto the exact data dependencies (URIs, DB keys, or file paths) queried by the agent during the speculative phase. Unrelated concurrent mutations can proceed, and the OCC Gate only aborts if the specific projected state has shifted:
$$ \mathcal{H}(\pi_R(\sigma_{now})) == \mathcal{H}(\pi_R(\sigma_0)) $$

**Implementation status, stated precisely:** $\pi_R$ and the OCC gate are formalized in [STM_ISOLATION_MAPPING.md](STM_ISOLATION_MAPPING.md) §4; the semantic-gate bound arithmetic is implemented and unit-tested (`evaluateSemanticGate` in `packages/receipt-schema/src/semanticAuditReceipt.ts`); the read-set projection is **not yet integrated** into the enforcement runtime. We therefore claim that the design answers the starvation objection at the specification level, and we do not claim a measured liveness result.

Empirically, the Tier-0 adversarial bench (replay, mutation, Unicode-canonicalization, and concurrency suites plus four formal games; `dab/bench/run_all.ts`) reports an in-suite attacker advantage of $\Delta = 0$ across 10,000 trials at HEAD, with the finite-sample confidence upper bound (≈ $3 \times 10^{-4}$ at that sample size) reported alongside rather than omitted. Reproduce with `make attack`. Per the bench's own non-claim header, this demonstrates detection under the modeled attacker only — it is not evidence about the live gateway TCB — and we cite no transactional commit-latency figures because none are recorded as committed evidence.

---

### Critique 4: Mitigation of Adaptive Agentic Worms
*Referees questioned how Ghost-Ark protects against emerging threat vectors like Adaptive Agentic Worms that dynamically generate exploits during multi-turn reasoning.*

**Response:**
Because agentic worms exploit the low marginal cost of LLM reasoning to adaptively scan and propagate, traditional static signatures fail to detect them. Ghost-Ark's design answer is architectural: decouple the reasoning loop from physical execution, so that propagation requires surviving an explicit commit pipeline.

If an agent becomes infected and attempts to write a worm payload to a peer node:
1. **The Ledger Gate** checks the transaction nonce against the active ledger and the spent tombstone set — the behavior verified in the corrected TLA+ model and now implemented in the Rust gateway (see Critique 2).
2. **The OCC Gate** (specified; implementation status in Critique 3) aborts commit when the projected read-set state has shifted, refusing commits built on stale reads.
3. **The Semantic Gate** evaluates the cumulative trajectory $\tau$: it computes the Fréchet upper bound on the probability that *any* step has failed — $\min\left(1, \sum_i p_i\right)$ over supplied per-step failure marginals, assuming nothing about independence between steps (implemented and unit-tested). If the bound exceeds policy, it forces a `SpeculativeCollapse`, discarding the speculative modifications before they reach the physical execution layer.

A comparison of the standard pipeline vs. Ghost-Ark's transactional pipeline is modeled below:

```
Standard Pipeline:
[Infected Agent] ---> (Egress Write Call) ---> [Target Runtime] (EXECUTES & SPREADS)

Ghost-Ark Pipeline:
[Infected Agent] 
    |
    v (Executes in Ghost Replica G_0)
[Speculative Trace]
    |
    v (Verification Pipeline)
 1. Ledger Gate    [Pass]
 2. OCC Gate       [Pass]
 3. Semantic Gate  [FAIL - Cumulative Drift Exceeds Policy]
    |
    v
[SpeculativeCollapse] (Reverts Runtime to G_0, Worm Payload Discarded)
```

The claim boundary matters here: the semantic gate aggregates the per-step failure scores it is given; it does not itself classify payload semantics. A worm's writes are discarded at the boundary **when the supplied step-failure marginals drive the cumulative bound over policy** — the architecture enforces the collapse mechanics and records the receipt trail; it does not certify any detector's hit rate.

---

These revisions address the referee critiques within stated bounds: recorded, replayable TLC verification for the nonce-ledger model (baseline clean, mutant violating); a tombstone implementation in the Rust gateway closing the previously disclosed model↔implementation divergence (bounded caveat stated in Critique 2); a specified — and partially implemented — OCC design answering the starvation objection; and a transactional pipeline whose collapse and detection mechanics are exercised by a reproducible Tier-0 adversarial bench. Ghost-Ark's claim boundary is unchanged: it provides cryptographic receipts and bounded governance evidence — what was recorded, signed, policy-bounded, and replayable under verifier rules — not semantic safety.
