# Agentic Execution as Software Transactional Memory (STM)
## Mapping Database Isolation Levels to Stochastic LLM Processes

This document formally models the Ghost-Ark framework not as an applied perimeter defense, but as a structural Software Transactional Memory (STM) primitive designed to bound non-deterministic (stochastic) compute sequences. By framing LLM context windows and tool-calling trajectories as discrete state-transitions over an isolated environment, we map traditional RDBMS isolation levels directly to AI agent architectures.

---

### 1. Read Uncommitted (The Dirty Write Anomaly)
**The Paradigm:** Standard API-coupled agent pipelines (e.g., typical LangChain or AutoGPT implementations).
**The Mechanism:** The agent evaluates a step and mutates external state instantaneously without a validation or commit phase. 
**The Anomaly:** If an agent hallucinates midway through a planned execution trajectory $\tau = \langle a_1, a_2, \dots a_n \rangle$, the preceding actions ($a_1, a_2$) have already leaked dirty state into the environment. There is no cryptographic capability to issue a rollback, leaving downstream systems in an unrecoverable, partially mutated state.

### 2. Read Committed (The Phantom Read / Write Skew Anomaly)
**The Paradigm:** Traditional Sandboxing (e.g., NemoClaw isolated execution).
**The Mechanism:** The agent's state-fork executes within a bounded sandbox (Firecracker/CRIU). It can read environmental data, but its intent to write is buffered in an `intent_pool`. 
**The Anomaly:** While the sandbox prevents immediate dirty writes, it does not prevent the agent from constructing a logically invalid chain of thought based on stale data. If the external world state $\sigma$ changes during the agent's prolonged reasoning phase, the eventual flush of the `intent_pool` applies stale reasoning to a shifted reality, inducing Write Skew or Phantom Read anomalies.

### 3. Serializable (Optimistic Concurrency Control for Non-Deterministic Compute)
**The Paradigm:** Ghost-Ark DAB Tier-0 (Declarative Action Binding).
**The Mechanism:** The framework implements Optimistic Concurrency Control (OCC) over the agentic sequence. The execution trace $\tau$ is isolated in a ghost replica $G(\sigma_0)$. The `VerifyAndBind` operation acts as the two-phase commit (2PC) validation phase.

---

### 4. Formalizing `SpeculativeCollapse` under the `DAB_NonceLedger`

To verify Serializability, the Gateway Reference Monitor enforces strict OCC validation. If validation fails, the system invokes `SpeculativeCollapse`, discarding the `execution_buffer` and reverting the agent's context window to the last cryptographically verified state $G(\sigma_0)$.

Let $\mathcal{L}_{nonce}$ represent the active `DAB_NonceLedger` and $S_{spent}$ represent the set of tombstoned nonces to prevent replay attacks.
Let $\sigma_t$ represent the cryptographic provenance hash of the external environment at time $t$.

An agent submits a trace of intended tool calls $\tau_{intent} = \langle a_1, \dots, a_k \rangle$ generated against a starting state $\sigma_0$. Each intended action $a_i$ carries a cryptographic nonce $n_i$ and a dependency on $\sigma_0$.

**The Validation Phase (`VerifyAndBind`)**
Before any action $a_i \in \tau_{intent}$ is handed to the `execution_buffer` for physical execution, the OCC validation phase checks two mathematical conditions:

1. **Replay & Liveness Check:** The nonce $n_i$ must not exist in the spent set, and must not currently be held by another concurrent intent.
   $$ n_i \notin S_{spent} \quad \text{and} \quad n_i \notin \mathcal{L}_{nonce} $$
2. **State Equivalence (Anti-Phantom Read):** The current environmental state $\sigma_{now}$ must cryptographically match the state upon which the agent based its reasoning ($\sigma_0$).
   $$ \mathcal{H}(\sigma_{now}) == \mathcal{H}(\sigma_0) $$

**The Abort Condition (`SpeculativeCollapse`)**
If either condition fails for any $a_i \in \tau_{intent}$, the Gateway rejects the entire speculative trace. The state transition is defined as:

$$
\text{SpeculativeCollapse}(\tau_{intent}) = 
\begin{cases} 
\text{Revert to } G(\sigma_0) & \text{if } \exists a_i \in \tau_{intent} : (n_i \in S_{spent} \lor \mathcal{H}(\sigma_{now}) \neq \mathcal{H}(\sigma_0)) \\
\text{Commit to } \mathcal{L}_{nonce} & \text{otherwise}
\end{cases}
$$

By enforcing `SpeculativeCollapse`, the Ghost-Ark framework provides structured evidence that the non-deterministic output of an AGI can be bound by deterministic serializable isolation constraints. It models the transformation of the unpredictable hallucination space of an LLM into a cryptographically accountable, fully rollback-capable transaction graph.
