# PART XIII — CONCLUSION AND LIMITATIONS

## 1. Conclusion of the Research Arc
The transition from deterministic computing to probabilistic AI execution requires a fundamental realignment of systems security. Ghost-Ark successfully demonstrates that the solution to AI misalignment is not to build a "smarter" semantic filter, but to build a rigid, deterministic cryptographic boundary around the agent's physical actions.

By completely isolating the Trusted Computing Base (TCB) in a Rust gateway and communicating solely via IPC and opaque byte hashing, the Declarative Action Binding (DAB) architecture definitively solves the Execution Integrity Gap. We have empirically proven that payload mutations and AST manipulation cannot bypass the $\Delta_{\text{DE}} = 0$ invariant. Through TLA+ model checking, we mathematically established the absence of replay and TOCTOU race conditions. Finally, by integrating the Provenance Lattice and applying Information Flow Control (IFC) at the tool-invocation boundary, Ghost-Ark forces the Attack Success Rate (ASR) of Indirect Prompt Injections (IPI) down to a strict 0%.

## 2. Limitations: The Confused Deputy Problem
While Ghost-Ark provides structured evidence regarding execution consistency and trust laundering, it is critical to state what the architecture *does not* solve. 

The Provenance Lattice brilliantly reduces IPI trust laundering ASR to 0% because an attacker cannot forge the cryptographic signature required to elevate tainted data into a privileged tier. However, if the agent operates entirely within a highly trusted tier (e.g., processing a cryptographically signed internal company memo), and the agent hallucinates or becomes confused by complex logic, it acts as a **Confused Deputy**. 

In a Confused Deputy scenario, the agent already possesses the legitimate clearance to execute the tool (e.g., `SOURCE_SIGNED`). If the agent decides to route authorized, sensitive data to a hostile destination, the Provenance Lattice alone will not block it, because the lattice merely checks if the data meets the minimum floor, which it does. 

Ghost-Ark bounds capabilities; it does not cure LLM gullibility. To mitigate the Confused Deputy limitation, the system must rely on strict namespace whitelists and predefined topological routing constraints (as implemented in `policy/evaluator.ts`). Cryptography can verify *what* was executed and *where* the triggering data came from, but it cannot fundamentally bestow an AI with flawless judgment.
