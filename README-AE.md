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
| 8 | Ledger-gate tombstone semantics: model↔implementation conformance is tested (§4.3) | `cd dab/gateway && cargo test` (needs Rust stable; **no `Cargo.lock`**, so `--locked` fails — see inventory §7.5) | nonce tests exercise within-TTL and post-TTL replay rejection and spent-set archival | exact |
| 9 | Full roll-up: build → claims → proofs → unit → attack → benchmark (§7) | `GHOST_SKIP_DISS=1 make reproduce` (or the container path above, PDF stage included) | `artifacts/reports/aec_summary.json` → `.status`, `.gating_failures`; exit 0 iff every gating stage passed | exact |

## What a reviewer cannot reproduce here (deliberately listed)

- **Any live-AWS behavior.** KMS-mode signing, cloud latency, the deployment
  sketch of the paper's §5.5 — design targets; no live evidence is bundled
  or claimed.
- **The DAB container path.** `dab/docker-compose.yml` build contexts and
  the 0-byte Dockerfiles are broken (inventory §7.5); `make attack`/
  `make benchmark` use the TypeScript suites directly. Note: some §7.5
  receipt-shape items have evolved since that section was written
  (`policy_digest` is now present in `dab/gateway/src/receipts.rs`), but no
  end-to-end gateway↔independent-verifier run is claimed until one is
  recorded.
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
