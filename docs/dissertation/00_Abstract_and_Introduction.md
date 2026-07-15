# Ghost-Ark and DAB: A Cryptographically Governed Execution Architecture for Verifiable AI Systems

## ABSTRACT

The rapid deployment of autonomous AI agents has exposed a critical vulnerability in modern systems design: relying on semantic guardrails to constrain execution behavior is fundamentally flawed. When adversarial inputs (e.g., Prompt Injection) compromise the agent's context, heuristic LLM-as-a-judge filters routinely fail to prevent unauthorized actions. This monograph introduces Ghost-Ark, a cryptographically governed execution architecture, and its core subsystem, Declarative Action Binding (DAB). Ghost-Ark shifts the security paradigm from unprovable semantic alignment to deterministic, physical execution evidence. By separating the untrusted agent runtime (V8) from a Trusted Computing Base (Rust gateway) via a Unix Domain Socket, DAB strictly enforces execution consistency ($\Delta_{\text{DE}} = 0$). To mitigate Indirect Prompt Injection (IPI) and data laundering, Ghost-Ark implements Information Flow Control (IFC) via a Provenance Lattice. Our evaluation demonstrates that DAB successfully detects and blocks 100% of AST and payload mutations out-of-band. Formal verification using TLA+ guarantees the mathematical impossibility of replay attacks within the sequence discipline. Finally, empirical simulations against the InjecAgent benchmark reveal that the Provenance Lattice's strict IFC mechanisms effectively reduce the Attack Success Rate (ASR) of IPI trust laundering from a baseline of 47% to an absolute 0%.

## INTRODUCTION

The integration of Large Language Models (LLMs) into autonomous execution environments has birthed the "Execution Integrity Gap"—the chasm between what a system *intended* the AI to do and the physical bytes the AI actually submitted for execution. Current agent architectures attempt to bridge this gap using semantic filters and iterative prompting. However, semantic intent is a hallucination; it is non-deterministic and entirely malleable by adversarial input.

When an AI agent operates within a Node.js/V8 environment, the execution runtime itself must be treated as hostile and compromised. Trusting the AI's output is insufficient. Ghost-Ark proposes that trust must move from semantic output claims to cryptographic execution evidence. If an agent claims to execute a safe action, the architecture must provide mathematical proof that the bytes observed by the network exactly match the bytes declared by the agent, and that the data triggering the action possessed the requisite cryptographic provenance.

### Core Contributions
This dissertation makes the following novel research contributions:

1. **Declarative Action Binding (DAB)**: A deterministic sequence and serialization discipline that bridges the gap between untrusted environments (TypeScript) and trusted gateways (Rust) without suffering from cross-language serialization traps.
2. **The $\Delta_{\text{DE}}$ Invariant**: The formalization of the divergence between declared agent intent and physical execution bytes ($\Delta_{\text{DE}} = | C_I \oplus C_E |$). We enforce $\Delta_{\text{DE}} = 0$ as a hard cryptographic invariant prior to execution.
3. **Formal Verification of Sequence Discipline**: A rigorously modeled TLA+ specification proving the atomic correctness of the ReplayLedger, guaranteeing immunity against concurrency and TOCTOU vulnerabilities.
4. **The Provenance Lattice**: A dynamic taint-tracking Information Flow Control (IFC) architecture that prevents "trust laundering" by strictly meeting claimed provenance against cryptographically verified provenance, reducing the ASR of IPI attacks to 0% without LLM monitoring.
