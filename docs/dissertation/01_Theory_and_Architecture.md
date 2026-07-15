# Ghost-Ark and DAB: A Cryptographically Governed Execution Architecture for Verifiable AI Systems

## PART I — FOUNDATIONAL THEORY

### Chapter 1: The Problem of Unverifiable Autonomous Computation

The prevailing paradigm in AI agent execution assumes that semantic alignment, rigorous prompting, and output monitoring are sufficient to constrain behavior. However, this assumption collapses under adversarial scrutiny. AI agents are inherently uncontrolled execution systems characterized by:

- **Semantic Uncertainty**: The stochastic nature of large language models makes deterministic bounds impossible at the semantic layer.
- **Hidden State**: Memory and contextual windows can be manipulated invisibly.
- **Prompt Injection & Supply Chain Compromise**: Adversaries can trivially bypass guardrails by mutating instructions or exploiting the execution environment.
- **Non-deterministic Inference Environments**: Identical inputs yield divergent outputs depending on latent factors such as sampling variance and quantization drift.

Trusting the model output is fundamentally insufficient because semantic guardrails cannot mathematically bind execution. Trust must move from output claims to execution evidence. The V8/Node.js environment in which the agent operates must be considered fully compromised. Any checks performed within the V8 runtime are inherently spoofable by a sufficiently capable attacker with arbitrary JS execution capabilities.

### Chapter 2: Ghost-Ark Philosophy

Ghost-Ark abandons semantic alignment in favor of cryptographic accountability.

- **Sovereignty**: Execution environments must define rigid, checkable boundaries.
- **Evidence Boundaries**: Claims of correct execution must be backed by a verifiable physical trace.
- **Provenance**: The system tracks exactly *what* was intended versus *what* was executed.
- **Cryptographic Accountability**: Every action is bound to a cryptographic receipt.
- **Claim Limitation**: Ghost-Ark does not claim an agent is "safe" or "aligned"; it claims only that an agent's intended action mathematically corresponds to the physical execution bytes.


## PART II — SYSTEM ARCHITECTURE

The architecture assumes that the untrusted Application Space (Node.js/V8) is hostile. The Trusted Computing Base (TCB) relies entirely on OS-level IPC isolation (`ipc_client.ts`) and the Rust daemon (`main.rs`).

### Component Dependency Map

1. **Application Space (Untrusted)**
   - `dab/agent-runtime/src/danf.ts`: Generates the Declared Action Normal Form (DANF).
   - `dab/agent-runtime/src/commitment.ts`: Derives the initial declaration commitment ($C_I$).
   - `dab/agent-runtime/src/ipc_client.ts`: Untrusted transport. Dispatches $C_I$ and the payload to the IPC socket.

2. **Gateway Space (TCB)**
   - `dab/gateway/src/main.rs`: Listens on `/ipc/dab.sock`. Independently computes the physical execution commitment ($C_E$) from the payload bytes.
   - `dab/gateway/src/verifier.rs`: Enforces the absolute invariant: $C_I == C_E$.
   - `dab/gateway/src/nonce.rs`: Maintains the replay ledger.
   - `dab/gateway/src/receipts.rs`: Generates the cryptographically signed `DABReceipt`.

### Trust Boundary Analysis

The critical trust boundary exists at the Unix Domain Socket (`/ipc/dab.sock`). The `ipc_client.ts` cannot be trusted to verify anything; it merely serves as a transport layer for the payload and the declaration commitment ($C_I$). 

Semantic guardrails fail because they attempt to sanitize intents within a compromised memory space. Ghost-Ark shifts trust to deterministic boundaries: the Rust gateway blindly hashes the raw bytes it receives ($C_E$). If the attacker modifies the bytes in transit to bypass a semantic guardrail, $C_I \neq C_E$, and the gateway immediately halts execution, issuing a `MUTATION_DETECTED_HALT` receipt.
