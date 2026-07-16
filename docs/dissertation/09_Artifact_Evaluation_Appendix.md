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
   **Expected Output**: The checker will exhaustively explore the bounded state space (1,321 distinct states for the shipped configuration) and report `Model checking completed. No error has been found.`, confirming `NoReplays` and `EventualGC` hold within the bounded tombstone model. This is a bounded model-checking result, not an implementation-safety claim — the implementation-mapping caveat (TTL eviction in `dab/gateway/src/nonce.rs`) is documented in `docs/artifact/repository_inventory.md` §7.2. Alternatively, run `bash scripts/run-proofs.sh` from the repository root: it checks every spec with a pinned `tla2tools`, expects mutants to violate, and records logs under `artifacts/proofs/logs/` (committed reference copies: `proofs/dab/artifacts/`).
3. Execute the TLC model checker against the falsifiable TOCTOU mutant:
   ```bash
   tlc -config DAB_NonceLedger.cfg DAB_NonceLedger_Mutant.tla
   ```
   **Expected Output**: The checker will immediately fail, printing an error trace demonstrating the exact sequence of concurrent states that violates the `NoReplays` invariant. This proves the validity and falsifiability of the model.

## 2. Reproducing the Empirical Evaluation ($\Delta_{\text{DE}}$)

To verify the physical execution consistency and the system's ability to halt AST/payload mutations, reviewers must run the local benchmark laboratory.

**Prerequisites:**
- Node.js v22+ (native TypeScript type-stripping; no `ts-node` and no additional dependencies required).

**Execution:**
1. Navigate to the project root:
   ```bash
   cd ghost-ark/
   ```
2. Execute the Tier-0 aggregate runner (all attack suites plus formal games and performance):
   ```bash
   node --experimental-strip-types dab/bench/run_all.ts --trials 10000
   ```
   **Expected Output**: A single JSON document on stdout with `all_passed: true` and `global_advantage: 0`. Within it:
   - `attacks`: every mutation/replay/unicode/concurrency entry reports `detected: true` — for `payload_field_mutation` and `single_byte_flip` the `expected` hash ($C_I$) strictly diverges from the `observed` hash ($C_E$); `mass_replay_flood` accepts exactly 1 execution and rejects the remainder; `double_execution_race` results in exactly 1 execution state transition.
   - `formal_games`: each game reports `advantage: 0` with its finite-sample confidence upper bound (≈ 3×10⁻⁴ at 10,000 trials) printed alongside, not omitted.

   Per the runner's own non-claim header: a green result demonstrates in-suite detection under the modeled attacker only; it is not a proof of safety and says nothing about the DAB gateway/verifier TCB.
