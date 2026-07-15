## PART IV — FORMAL SECURITY MODEL

### Security Assumptions
- **Adversary Model**: The adversary has arbitrary, unconstrained JavaScript execution capabilities within the Node.js/V8 process. The adversary can hook functions, mutate memory, and intercept IPC calls.
- **Isolation Assumption**: The adversary does not have direct memory access to the Rust gateway process. The OS enforces strict process isolation and Unix Domain Socket access controls.
- **Cryptographic Assumption**: SHA-256 is collision-resistant, and the gateway's signing keys cannot be extracted.

### Formal Definitions

Let $D_{raw}$ be the intended declarative action.
Let $C_I$ be the Declaration Commitment generated in the untrusted space.
Let $C_E$ be the Execution Commitment generated in the trusted gateway.

**$\Delta_{\text{DE}}$ (Declaration-Execution Divergence):**
The divergence between the declared intent and the physical bytes sent over the network.
$$\Delta_{\text{DE}} = | C_I \oplus C_E |$$
A valid execution requires $\Delta_{\text{DE}} = 0$.

**$\Delta_{\text{custody}}$:**
The gap in cryptographic custody between the generation of $C_I$ and its arrival at the gateway. Due to V8 compromise, $\Delta_{\text{custody}}$ is assumed to be infinite (untrusted). The gateway heals this gap by asserting $C_I == C_E$.

### State Machine Formalization (`nonce.rs`)

The `ReplayLedger` acts as an append-only set with a TTL garbage collection bound.
Given a ledger state $L_t$ at time $t$, and an incoming request with nonce $N$:
$$ L_{t+1} = \begin{cases} L_t \cup \{N\}, & \text{if } N \notin L_t \\ L_t, & \text{if } N \in L_t \end{cases} $$

If $N \in L_t$, the gateway transitions to `REPLAY_REJECTED`.


## PART V — FORMAL VERIFICATION ROADMAP

To guarantee mathematical replay resistance, we define the following TLA+ proof obligations:

1. **Safety (No Replays)**: 
   `[] (Execution(N) => ~(N \in Ledger))`
   It is always the case that if an execution occurs for nonce $N$, $N$ was not previously in the ledger.

2. **Liveness (Eventual Garbage Collection)**:
   `[] (N \in Ledger /\ Time > CreatedAt(N) + TTL => <> (N \notin Ledger))`

3. **Concurrency Integrity (No Race Conditions)**:
   If two requests $(C_{I_1}, N)$ and $(C_{I_2}, N)$ arrive concurrently, only one may successfully transition the ledger and trigger execution.
