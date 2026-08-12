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
Node v22.22.3. We have **not** measured a second host, so expect the *ordering*
of the cost arms and their baseline ratios to hold and the absolute microseconds
not to; the **exact-match claims** (detection counts, state counts, test counts,
gate status) are machine-independent.

> **Superseded rows.** Until 2026-08-02 rows 2 and 3 pointed a reviewer at
> `dab/bench/run_all.ts` — a directory whose own README reads "QUARANTINED: not
> evidence about Ghost-Ark", because several of its suites report `detected: true`
> without invoking any component under test. Reproducing those rows would have
> confirmed a number that measured nothing. They are re-sourced below to E2/E3/E4,
> which invoke the real verifier and carry a control arm. Recorded as **R10** in
> `docs/research/EXPERIMENTS.md`.

## The map

| # | Paper claim (section) | Command | Expected signal | Match |
|---|---|---|---|---|
| 1 | Five TLC baselines clean; **four** mutants reproduce violations; distinct-state counts in Table 2 (§5.1) | `make proof` | `artifacts/proofs/proofs_summary.json` → `all_gating_passed: true`; per-module `distinct_states`: ProvenanceLattice 403,949 / SpeculativeCollapse 529 / TransportBoundary 64 / DAB_NonceLedger 1,321 / DAB_ExecutionBoundary 51,106; the four mutants each report `VIOLATION_REPRODUCED` on every run. **Do not match mutant `distinct_states` against a constant** — retraction R11: a mutant halts at the first counterexample under `-workers auto`, so its count varies with thread scheduling (measured n=10 on one host: 61-63 / 193-431 / 22-23 / 185-332). The verdict reproduces; the count does not. Baseline counts above ARE exact. **`DAB_ExecutionBoundary` has no mutant** — its clean result is one-sided, and `TenantIsolation` is a `DECLARED_STUB` excluded from the gate | verdicts exact; mutant counts are ranges (R11) |
| 2 | Corpus detection: 26/26 verifier-intrinsic, 3/3 control arm, 0 undetected, 2 documented boundaries (§5.2) | `npm run experiment:e3` | `verifier-intrinsic: 26/26`, `control arm: 3/3`, `undetected 0`. Census provenance — exact counts, no interval | exact |
| 2b | Those detections are load-bearing, not tautological (§5.2) | `npm run experiment:e4` | `TAUTOLOGY VERDICT: PASS`; 7 load-bearing checks; with every check forced to pass only a parse failure still rejects | exact |
| 3 | Verification cost, p50 with IQR against a parse-only baseline (§5.3, Table 3) | `npm run experiment:e2` | six arms; `verifier-full-hmac` ≈23 µs p50, `verifier-full-rsa-pss` ≈126 µs p50 ≈66× the `json-parse-only` baseline; `monotonicity self-audit: 4/4` | ordering and ratios exact; absolute µs vary by host |
| 4 | 1,274 tests / 165 files pass at HEAD (§7) | `make unit` | `Test Files 164 passed \| 1 skipped (165)`, `Tests 1265 passed \| 9 skipped (1274)` (measured 2026-08-11) | **green, not equal** — see note |
| 5 | Claim-language gate: 0 violations repo-wide, manuscript included — `.tex`/`.bib` are scannable (§7) | `npm run scan:claims` | `Checked N scannable files. No forbidden assurance overclaims detected.` | exact |
| 6 | Semantic gate implements the dependence-free Fréchet union upper bound `min(1, Σ pᵢ)` (§4.2) | `npx vitest run tests/unit/receipt-schema/semanticAuditReceipt.test.ts` | suite passes; tests pin the bound to hand-computed values and the PASSED/FAILED_DRIFT_BOUNDS threshold behavior | exact |
| 7 | Receipts verify under an independent implementation; negative corpus rejects malformed envelopes (§3.5) | `npm run receipt:verify:independent && npm run receipt:verify:corpus && npm run receipt:verify:agreement` | all pass | exact |
| 8 | **Gateway↔independent-verifier round-trip** (real ed25519): a receipt from the gateway binary's shipped signing path verifies against the independent verifier; tamper/mutation/wrong-key are rejected (§3.5) | `bash dab/roundtrip/run_in_docker.sh` (or `run_roundtrip.sh` with a host toolchain); unit evidence: `cd dab/gateway && cargo test --locked` and `cd dab/verifier && cargo test --locked` | `ROUND-TRIP: OK` (5/5); deterministic pubkey `4cb5abf6…`; gateway 13 + verifier 13 unit tests pass (verifier includes a brutal forgery corpus: protocol downgrade, non-hex/truncated/all-zero/transplanted signatures, missing field, empty key — each rejected with its specific error). Recorded: `dab/roundtrip/RECORDED_ROUNDTRIP.txt` | exact |
| 8b | Same round-trip **on Kubernetes**: gateway (init container) emits a receipt; a separate verifier container accepts it in-cluster | `bash dab/k8s/run_demo.sh` (needs a cluster; loads the image into the node — no registry) | Job `dab-roundtrip` completes; verifier logs `VERIFIED`. Recorded: `dab/k8s/RECORDED_K8S.txt` | exact (given a cluster) |
| 8c | **Full socket transport E2E** over the real `/ipc/dab.sock`: a Rust agent client drives the running gateway; the **wired tombstone ledger** rejects replay (§4.3) | `bash dab/roundtrip/run_socket_e2e_in_docker.sh` | `SOCKET-E2E: OK` (3/3): certified-over-socket → `VERIFIED`; same nonce again → `REPLAY_REJECTED` (wired `ReplayLedger.consume`); mutation → `MUTATION_DETECTED_HALT`. Recorded: `dab/roundtrip/RECORDED_SOCKET_E2E.txt` | exact (timestamps vary) |
| 8d | Rust crates are lint-clean under a hostile bar | `cd dab/gateway && cargo clippy --locked --all-targets -- -D warnings` (and `dab/verifier`) | clean; gateway 13 + verifier 13 tests pass | exact |
| 8e | **The bounded replay window is measured**, not just stated: window $=\max(0,K-C)$ for $K$ tombstones at capacity $C$ (§6 item 5, Fig 4) | `cd dab/gateway && cargo run --locked --bin dab-replay-stress` | `LAW CONFIRMED`; all 11 measured rows carry `yes` in the tab-separated `ok` column (capacity 8–100, tombstones 1–1000), 0 rows `no`. Recorded: `dab/roundtrip/RECORDED_REPLAY_WINDOW.txt` | exact |
| 8f | **Concurrent Rust TCB throughput, measured** (two-phase, fail-closed aware): ≈275k admissions + real ed25519 signatures/s within ledger capacity (64 threads, 96,000 ops); ≈10.1M fail-closed rejections/s at capacity (§5.3) | `cd dab/gateway && cargo run --release --bin stress` | stdout: `Phase A … ops/sec (admission + real ed25519 sign)`, `Phase B … rejections/sec`, `SANITY OK` (two-sided: all in-capacity ops must admit, all at-capacity ops must refuse; non-zero exit otherwise). Recorded: `dab/roundtrip/RECORDED_CONCURRENT_STRESS.txt` | within machine variance |
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
  or safety of model output. The corpus results are rejection counts from the
  real standalone verifier over a hand-authored census, with the coverage
  boundary stated in EXPERIMENTS.md §E3 (no compromised-signer, chain-level,
  omission, timing, or key-rotation fixtures).
- **Anything from `dab/bench/`.** That directory is quarantined and is not
  evidence about this system; see the superseded-rows note above.

## Badge targeting (ACM/USENIX)

- **Artifacts Available** — requires a public, immutable, citable snapshot:
  tag a release and archive it (e.g., Zenodo DOI). *Author action; a GitHub
  URL alone does not qualify as immutable.*
- **Artifacts Evaluated — Functional** — target: rows 1–7 and 9 run
  green from the reviewer container with one command each.
> **On row 4's match column.** A test count is commit-relative: it changes the
> moment anyone adds a test, including the three hygiene guards added on
> 2026-08-02. Demanding an exact match would make the row fail for the healthiest
> possible reason. The reproducible claim is **the suite is green and the count
> is at least the recorded figure**; a *lower* count means tests were removed and
> is the case worth investigating. The figure is dated so the direction of any
> difference is checkable.

- **Results Reproduced** — target: rows 1, 2, 2b, 5, 6 exactly; row 4 green with
  a count ≥ the recorded figure; row 3 by
  ordering and ratio only (the paper claims microsecond *scale* on one named
  host, not a universal constant, and no second host has been measured).

## Regenerating the paper

```bash
bash docs/paper/build.sh   # claim gate (fail-closed) → latexmk
```

The build refuses to emit a PDF if the claim-language gate is red.
