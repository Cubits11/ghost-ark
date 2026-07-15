# APPENDIX A: USENIX ARTIFACT EVALUATION GUIDE

This appendix provides a step-by-step guide for USENIX Artifact Evaluation Committee (AEC) members to independently reproduce the empirical and mathematical claims made in this dissertation.

## 1. Reproducing the Formal Verification (TLA+)

To verify the `NoReplays` safety invariant and the `EventualGC` liveness property, reviewers must run the TLC Model Checker against the provided TLA+ specifications.

**Prerequisites:**
- Java Runtime Environment (JRE) 11+
- TLA+ Toolbox or TLC command-line tools.

**Execution:**
1. Navigate to the formal proofs directory:
   ```bash
   cd proofs/dab/
   ```
2. Execute the TLC model checker against the valid sequence discipline:
   ```bash
   tlc -config DAB_NonceLedger.cfg DAB_NonceLedger.tla
   ```
   **Expected Output**: The checker will exhaustively explore the state space and report `Model checking completed. No error has been found.`, confirming mathematical immunity to replays and race conditions.
3. Execute the TLC model checker against the falsifiable TOCTOU mutant:
   ```bash
   tlc -config DAB_NonceLedger.cfg DAB_NonceLedger_Mutant.tla
   ```
   **Expected Output**: The checker will immediately fail, printing an error trace demonstrating the exact sequence of concurrent states that violates the `NoReplays` invariant. This proves the validity and falsifiability of the model.

## 2. Reproducing the Empirical Evaluation ($\Delta_{\text{DE}}$)

To verify the physical execution consistency and the system's ability to halt AST/payload mutations, reviewers must run the local benchmark laboratory.

**Prerequisites:**
- Node.js (v18+)
- TypeScript and `ts-node` globally or locally installed.

**Execution:**
1. Navigate to the project root:
   ```bash
   cd ghost-ark/
   ```
2. Execute the mutation attack suite:
   ```bash
   npx ts-node dab/bench/attacks/mutation.ts
   ```
   **Expected Output**: A JSON array will be printed to stdout. Reviewers should note that for `payload_field_mutation` and `single_byte_flip`, the `detected` flag is `true`, and the `expected` hash ($C_I$) strictly diverges from the `observed` hash ($C_E$). This proves that $\Delta_{\text{DE}} = 1$ safely halts execution.
3. Execute the replay attack suite:
   ```bash
   npx ts-node dab/bench/attacks/replay.ts
   ```
   **Expected Output**: The output will demonstrate the `mass_replay_flood` test accepting exactly 1 execution and successfully blocking the remaining attempts.
4. Execute the concurrency attack suite:
   ```bash
   npx ts-node dab/bench/attacks/concurrency.ts
   ```
   **Expected Output**: The output will confirm the `double_execution_race` results in exactly 1 execution state transition.
