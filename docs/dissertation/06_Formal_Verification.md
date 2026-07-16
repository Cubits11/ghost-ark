# PART XI — FORMAL VERIFICATION OF THE DAB TCB

## 1. Formal Sequence Discipline Specification (TLA+)
To rigorously verify the `ReplayLedger` implementation found in `dab/gateway/src/nonce.rs`, we define a finite-state machine in TLA+ (`DAB_NonceLedger.tla`). The ledger operates as a garbage-collected set of consumed nonces. Since the Rust daemon runs a multithreaded architecture over a single Unix Domain Socket, multiple "agents" (concurrent threads) may attempt to push the same payload with the same nonce simultaneously.

The true TLA+ specification atomicizes the check and the commit inside `ConsumeNonce`, and checks the candidate nonce against both the active ledger and a `spent` tombstone set so that garbage collection cannot recycle a consumed nonce:
```tla
ConsumeNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \notin ledger
    /\ n \notin spent
    /\ Cardinality(ledger) < MaxLedgerSize
    /\ ledger' = ledger \cup {n}
    /\ agentState' = [agentState EXCEPT ![a] = "Executed"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED spent
```
`GarbageCollect(n)` archives nonces into `spent` rather than forgetting them, which is what allows `NoReplays` to survive ledger cleanup in the model.

By locking the Mutex in Rust across the entire `contains_key` and `insert` block, the implementation matches the atomicity this TLA+ step requires (no TOCTOU window). **The retention semantics, however, currently diverge**: the model archives durable tombstones, while `ReplayLedger` in `dab/gateway/src/nonce.rs` evicts entries after `NONCE_TTL_SECONDS = 3600` with no tombstone or wire-freshness check, so the model's `NoReplays` transfers to the implementation only for replays attempted within the TTL window. This open gap is tracked in `docs/artifact/repository_inventory.md` §7.2 and must be closed (durable tombstones, enforced freshness, or an honest TTL model) before any implementation-level replay claim is made.

## 2. Invariant Modeling: Safety and Liveness
The TLA+ model checks two critical invariants:
- **Safety (`NoReplays`)**: `\A a1, a2 \in Agents : (a1 # a2 /\ agentState[a1] = "Executed" /\ agentState[a2] = "Executed") => agentNonce[a1] # agentNonce[a2]`
This asserts that no two distinct execution branches can successfully transition to "Executed" using the identical nonce.
- **Liveness (`EventualGC`)**: `\A n \in Nonces : (n \in ledger) ~> (n \notin ledger)`
Using temporal logic ("leads to", `~>`), this proves that any nonce committed to the ledger will eventually be removed, satisfying the maximum memory boundary (`MAX_LEDGER_ENTRIES`) and preventing resource exhaustion DOS.

## 3. The TOCTOU Counter-Example (`DAB_NonceLedger_Mutant.tla`)
To prove that our model accurately catches sequence vulnerabilities, we modeled a mutated, vulnerable state machine (`DAB_NonceLedger_Mutant.tla`). In this mutant, the check and the commit operations are separated—a classic Time-Of-Check to Time-Of-Use (TOCTOU) race condition:
```tla
CheckNonce(a, n) ==
    /\ n \notin ledger
    /\ agentState' = [agentState EXCEPT ![a] = "Checked"]

CommitNonce(a) ==
    /\ agentState[a] = "Checked"
    /\ ledger' = ledger \cup {agentNonce[a]}
    /\ agentState' = [agentState EXCEPT ![a] = "Executed"]
```
When this mutant specification is fed to the TLC Model Checker, the `NoReplays` invariant fails (recorded run: `proofs/dab/artifacts/DAB_NonceLedger_Mutant.tlc.txt`, 232 distinct states explored before the counterexample; regenerate with `scripts/run-proofs.sh`). 

**TLC Trace of Failure:**
1. State 1: Ledger is empty `{}`.
2. State 2: Agent 1 (`a1`) executes `CheckNonce(a1, n1)`. State transitions to `Checked`.
3. State 3: Agent 2 (`a2`) concurrently executes `CheckNonce(a2, n1)`. Since $n_1$ is still not in the ledger, its state also transitions to `Checked`.
4. State 4: Agent 1 executes `CommitNonce(a1)`, inserting $n_1$ into the ledger and transitioning to `Executed`.
5. State 5: Agent 2 executes `CommitNonce(a2)`, inserting $n_1$ again and transitioning to `Executed`.
6. TLC halts at State 5, reporting `Invariant NoReplays is violated`: `agentState[a1] = "Executed"` and `agentState[a2] = "Executed"` with the same nonce $n_1$.

## 4. Synthesis of Mathematical and Empirical Evidence
The empirical fuzzing data from Chapter 4 proved that our real-world V8 execution environment accurately handled $10,000$ concurrent flood attempts, rejecting $9,999$ of them. However, fuzzing alone is probabilistic; it proves resistance to an attack, not immunity.

By pairing the empirical fuzzer data with the exhaustive bounded TLA+ state-space exploration (1,321 distinct states for the baseline configuration; recorded run: `proofs/dab/artifacts/DAB_NonceLedger.tlc.txt`), Ghost-Ark establishes execution consistency evidence within stated bounds. The TLA+ model verifies the tombstone retention design against replay faults, and the empirical benchmarks exercise the Rust Mutex's atomic check-and-insert, which matches the atomicity the formal model requires. The retention divergence between model and implementation (§1 above; inventory §7.2) remains an open item and is deliberately excluded from this claim.
