# README-AE — Claim-to-Command Map

This file binds every empirical claim in the conference manuscript
(`docs/paper/main.tex`) to the command that regenerates it. It complements
[`ARTIFACT_EVALUATION.md`](ARTIFACT_EVALUATION.md) (reviewer entry point,
environment, troubleshooting) and
[`docs/artifact/repository_inventory.md`](docs/artifact/repository_inventory.md)
(authoritative blocker list). If a claim is not in this table, the paper
should not be making it.

> **Claim boundary.** Ghost-Ark provides cryptographic receipts and bounded
> governance evidence. It verifies what was recorded, signed, policy-bounded,
> and replayable under Ghost-Ark verifier rules. It does **not** prove
> semantic safety, truth, compliance, alignment, production readiness, or
> deployment correctness.

## Environment

Hermetic path (no host setup beyond Docker):

```bash
docker compose -f docker-compose.reviewer.yml build
docker compose -f docker-compose.reviewer.yml run --rm reviewer make reproduce
```

Native path: Node 22, JDK ≥ 11, `make bootstrap` once. Reference machine for
the paper's latency numbers: Apple M1, 8 GB, macOS (Darwin 24.5.0, arm64),
Node v22.22.3 — latency reproduces within machine variance; the
**exact-match claims** (advantage, detection flags, state counts, test
counts, gate status) are machine-independent.

## The map

| # | Paper claim (section) | Command | Expected signal | Match |
|---|---|---|---|---|
| 1 | Five TLC baselines clean; five mutants reproduce violations; distinct-state counts in Table 2 (§5.1) | `make proof` | `artifacts/proofs/proofs_summary.json` → `all_gating_passed: true`; per-module `distinct_states`: ProvenanceLattice 403,949 / SpeculativeCollapse 529 / TransportBoundary 64 / DAB_NonceLedger 1,321 / DAB_ExecutionBoundary 51,106; mutants report `VIOLATION_REPRODUCED` | exact |
| 2 | Modeled-attacker advantage 0 across 4 games × 10,000 trials; 9-attack corpus all detected (§5.2) | `node --experimental-strip-types dab/bench/run_all.ts --trials 10000` | JSON → `global_advantage: 0`, `all_passed: true`; each `formal_games.games[].advantage == 0`; every `attacks.*[].detected == true` | exact |
| 3 | End-to-end enforcement ≈5.5 µs p50 / ≈7.1 µs mean; ≈6.6 µs mean added over baseline; ≈141k ops/s (§5.3, Table 3) | same command as #2 (the `performance` block), or `make benchmark` → `artifacts/benchmarks/performance.json` | microsecond-scale `p50_ms`/`average_ms` (e.g. `0.0055` ms p50 on the reference machine); `overhead_percent` ≈ 10³ vs the no-op baseline — the paper explains why the absolute number, not this ratio, is the decision-relevant figure | within machine variance |
| 4 | 640 tests / 97 files pass at HEAD (§7) | `make unit` | `Test Files 97 passed`, `Tests 640 passed` | exact |
| 5 | Claim-language gate: 0 violations repo-wide, manuscript included — `.tex`/`.bib` are scannable (§7) | `npm run scan:claims` | `Checked N scannable files. No forbidden assurance overclaims detected.` | exact |
| 6 | Semantic gate implements the dependence-free Fréchet union upper bound `min(1, Σ pᵢ)` (§4.2) | `npx vitest run tests/unit/receipt-schema/semanticAuditReceipt.test.ts` | suite passes; tests pin the bound to hand-computed values and the PASSED/FAILED_DRIFT_BOUNDS threshold behavior | exact |
| 7 | Receipts verify under an independent implementation; negative corpus rejects malformed envelopes (§3.5) | `npm run receipt:verify:independent && npm run receipt:verify:corpus && npm run receipt:verify:agreement` | all pass | exact |
| 8 | **Gateway↔independent-verifier round-trip** (real ed25519): a receipt from the gateway binary's shipped signing path verifies against the independent verifier; tamper/mutation/wrong-key are rejected (§3.5) | `bash dab/roundtrip/run_in_docker.sh` (or `run_roundtrip.sh` with a host toolchain); unit evidence: `cd dab/gateway && cargo test --locked` and `cd dab/verifier && cargo test --locked` | `ROUND-TRIP: OK` (5/5); deterministic pubkey `4cb5abf6…`; gateway 7 + verifier 13 unit tests pass (verifier includes a brutal forgery corpus: protocol downgrade, non-hex/truncated/all-zero/transplanted signatures, missing field, empty key — each rejected with its specific error). Recorded: `dab/roundtrip/RECORDED_ROUNDTRIP.txt` | exact |
| 8b | Same round-trip **on Kubernetes**: gateway (init container) emits a receipt; a separate verifier container accepts it in-cluster | `bash dab/k8s/run_demo.sh` (needs a cluster; loads the image into the node — no registry) | Job `dab-roundtrip` completes; verifier logs `VERIFIED`. Recorded: `dab/k8s/RECORDED_K8S.txt` | exact (given a cluster) |
| 8c | **Full socket transport E2E** over the real `/ipc/dab.sock`: a Rust agent client drives the running gateway; the **wired tombstone ledger** rejects replay (§4.3) | `bash dab/roundtrip/run_socket_e2e_in_docker.sh` | `SOCKET-E2E: OK` (3/3): certified-over-socket → `VERIFIED`; same nonce again → `REPLAY_REJECTED` (wired `ReplayLedger.consume`); mutation → `MUTATION_DETECTED_HALT`. Recorded: `dab/roundtrip/RECORDED_SOCKET_E2E.txt` | exact (timestamps vary) |
| 8d | Rust crates are lint-clean under a hostile bar | `cd dab/gateway && cargo clippy --locked --all-targets -- -D warnings` (and `dab/verifier`) | clean; gateway 7 + verifier 13 tests pass | exact |
| 9 | Full roll-up: build → claims → proofs → unit → attack → benchmark (§7) | `GHOST_SKIP_DISS=1 make reproduce` (native, or hermetically in the reviewer container) | `artifacts/reports/aec_summary.json` → `.status`, `.gating_failures`; exit 0 iff every gating stage passed. Reviewer-container lane verified PASS 2026-07-16 | exact |

## What a reviewer cannot reproduce here (deliberately listed)

- **Any live-AWS behavior.** KMS-mode signing, cloud latency, the deployment
  sketch of the paper's §5.5 — design targets; no live evidence is bundled
  or claimed.
- **The TypeScript `dab/agent-runtime/` library.** The Unix-socket transport
  is now exercised (row 8c) by a **Rust** agent client (`dab-agent`); the
  TypeScript agent library still has no runnable entrypoint and is not on any
  claimed path. `receipts.rs` and `gateway/src/verifier.rs` likewise remain
  orphaned parallel surfaces (dead code; the live paths are `GatewayReceipt` in
  `main.rs` and the `dab-verifier` crate).
- **Live-cloud key custody and attestation.** The signing key is a local DEV
  ed25519 key; KMS asymmetric keys by immutable ARN, and any hardware
  attestation, remain unimplemented and unclaimed.
- **Anything semantic.** No command here measures truthfulness, alignment,
  or safety of model output; the corpus results are in-suite detection under
  the modeled attacker (the non-claim header at the top of
  `dab/bench/run_all.ts` is normative).

## Badge targeting (ACM/USENIX)

- **Artifacts Available** — requires a public, immutable, citable snapshot:
  tag a release and archive it (e.g., Zenodo DOI). *Author action; a GitHub
  URL alone does not qualify as immutable.*
- **Artifacts Evaluated — Functional** — target: rows 1–7 and 9 run
  green from the reviewer container with one command each.
- **Results Reproduced** — target: rows 1, 2, 4, 5, 6 exactly; row 3 within
  machine variance (the paper claims microsecond *scale* and reports the
  reference machine, not a universal constant).

## Regenerating the paper

```bash
bash docs/paper/build.sh   # claim gate (fail-closed) → latexmk
```

The build refuses to emit a PDF if the claim-language gate is red.
