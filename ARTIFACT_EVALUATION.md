# Ghost-Ark — Artifact Evaluation

This is the entry point for USENIX Security AEC reviewers. If you read only one
file, read this one.

Ghost-Ark is an AWS-native reference implementation for **bounded governance
receipts and deterministic enforcement primitives** around LLM/agentic AI
applications. DAB (Declarative Action Binding) is its Tier-0 execution-consistency
subsystem. The CC-Framework is the measurement science for correlated guardrail
failure.

> **Claim boundary.** Ghost-Ark provides cryptographic receipts and bounded
> governance evidence. It verifies what was recorded, signed, policy-bounded, and
> replayable under Ghost-Ark verifier rules. It does **not** prove semantic
> safety, truth, compliance, alignment, production readiness, or deployment
> correctness.

---

## ⚠️ Current status — read before you run

This artifact is **honest, not green**. `make reproduce` runs real commands, and
at the current commit it **exits non-zero** because of pre-existing, documented
blockers in the repository (not in this harness). This is deliberate: an
artifact-evaluation harness must report the repository's real state, not a
manufactured pass.

| Stage | Result today | Why |
|-------|--------------|-----|
| Build / typecheck | ✅ pass | — |
| Claim-language gate | ❌ fail | 11 forbidden-claim phrases in the dissertation chapters |
| Proofs — `proofs/tla` | ✅ pass | ProvenanceLattice / SpeculativeCollapse / TransportBoundary + mutants |
| Proofs — `proofs/dab` | ❌ quarantined | specs are invalid TLA+ (`\setminus`); once corrected the baseline **refutes its own** `NoReplays` claim |
| Unit/integration | ✅ pass (load-tolerant timeout) | 6 CDK-synth tests time out only under default 15s + full-suite load |
| Attack — root security | ✅ pass | policy fuzzer, negative corpus, tenant boundary |
| Attack — DAB bench | ❌ fail | two suites score **backwards** (a detected replay is counted as an attacker win) |
| Benchmark | ▶ runs | real latency/throughput/overhead numbers exported |
| Dissertation PDF | ⏸ blocked | gated by the RED claim gate; also needs pandoc+latexmk |

Full evidence for each item, with the exact commands, is in
[`docs/artifact/repository_inventory.md`](docs/artifact/repository_inventory.md)
§7. None of these are the harness's doing; the harness surfaces them.

**What a reviewer can verify today:** the `proofs/tla` family checks cleanly and
reproducibly, the root security suite passes, the receipt verifier/differential
tests pass, and the reporting pipeline produces a faithful machine-readable
summary. **What is not yet reproducible:** the DAB formal-verification and DAB
empirical claims, and a claim-clean PDF.

---

## 1. System requirements

- **Linux x86_64** or **Apple Silicon via Docker**. Native macOS also works if you
  install the toolchain below.
- To run everything with **zero host setup**, use the container (§4). Otherwise:
  - Node.js **22** (the repo `engines` and CI target 22; the DAB benches use
    native `.ts` execution available on 22+)
  - OpenJDK **≥ 11** (21 recommended) for the TLC model checker
  - `git`, `make`, `jq`, `curl`, `python3`
  - Rust stable **only** if you intend to build the DAB Rust TCB (`dab/gateway`,
    `dab/verifier`) — note there is currently **no `Cargo.lock`**, so
    `cargo build --locked` will not work until one is generated
  - `pandoc` + `latexmk` + TeX Live **only** for the dissertation PDF

## 2. Expected runtime

| Path | Approx. wall-clock |
|------|--------------------|
| `make proof` (proofs/tla family) | ~15–25 s |
| `make attack` | ~30–60 s |
| `make benchmark` | ~5–15 s |
| `make unit` (full vitest) | ~2.5–3.5 min |
| `make reproduce` (all, no PDF) | ~4–5 min |
| Reviewer image build (first time, TeX Live) | ~5–12 min |

The compute-only stages fit the "under five minutes" AE target; the one-time
container build is dominated by TeX Live.

## 3. Quick start (native)

```bash
make bootstrap        # install deps + fetch pinned tla2tools.jar
make proof            # TLA+ proofs (proofs/tla passes; proofs/dab quarantined)
make attack           # root security suite (pass) + DAB bench (currently red)
cat artifacts/reports/aec_summary.md   # after `make reproduce`
```

## 4. One-command reproduction

Native:

```bash
make reproduce
```

Fully hermetic (no host setup beyond Docker):

```bash
docker compose -f docker-compose.reviewer.yml build
docker compose -f docker-compose.reviewer.yml run --rm reviewer make reproduce
# reports appear on the host under ./artifacts/reports/
```

`make reproduce` runs: **build → claims → proof → unit → attack → benchmark →
dissertation → artifact-report**, writing per-stage status to `artifacts/status/`
and a rolled-up report to `artifacts/reports/aec_summary.{json,md}`. It prints the
USENIX report banner and exits 0 **iff** every gating stage passed.

Useful env: `GHOST_AEC_QUICK=1` (smaller trial counts), `GHOST_SKIP_DISS=1` (skip
the PDF), `VITEST_TIMEOUT_MS=60000` (unit-test timeout).

## 5. Benchmark interpretation

`make benchmark` writes `artifacts/benchmarks/`:

- `performance.json` — baseline/commitment/verification/end-to-end latency
  (p50/p95/p99), throughput (ops/sec), and `overhead_percent` (end-to-end vs.
  baseline).
- `formal_games.json` — four security games, each with an attacker `advantage`
  (fraction of trials the modeled attacker "wins") and per-game latency.
- `benchmarks_summary.json` — a digest.

**Caveat (do not skip):** the DAB formal-game attacker-advantage figures reflect
the benchmark's **current, partly inverted accounting** — `replayGame` scores a
*detected* replay as an attacker win, so it reports advantage ≈ 0.998 where a
correct accounting yields 0 (inventory §7.6). Read these numbers as evidence that
the harness needs correcting, not as a measured defense failure.

## 6. Threat model (as modeled)

- **DAB execution consistency**: an untrusted agent runtime declares an action
  commitment `C_I`; a separate gateway independently derives `C_E` from the bytes
  it will execute and refuses to execute unless `C_I == C_E`, with nonce-based
  replay rejection. Modeled attacker: in-flight payload/AST mutation, replay,
  serialization/Unicode collision, cross-transaction confusion.
- **IFC provenance lattice**: data triggering an action must carry sufficient
  cryptographic clearance (meet-based delegation admission), modeling indirect
  prompt-injection "trust laundering."
- **Receipts**: KMS/HMAC-signed decision receipts with deterministic canonical
  JSON, replayable by an independent verifier (Node and Python).

What is **out of scope / not claimed**: semantic correctness of model output,
alignment, compliance certification, hardware attestation (no live Nitro flow),
and the full AWS cloud path (no live-AWS evidence bundled here).

## 7. Known limitations (authoritative list: inventory §7)

1. `proofs/dab/*.tla` are invalid TLA+ and, once corrected, the baseline violates
   its own `NoReplays` invariant (GarbageCollect reintroduces replay). The DAB
   formal claim is **unverified**.
2. The claim-language gate is RED: dissertation prose exceeds the claim boundary.
3. The DAB benchmark scores two suites backwards; `global_advantage ≈ 0.25`.
4. Full `npm test` needs a raised per-test timeout to avoid load-induced
   CDK-synth flakiness (the harness sets `--test-timeout=60000`).
5. The DAB container path (`dab/docker-compose.yml`), the DAB Rust
   gateway↔verifier receipt shape, and `cargo --locked` are broken/incomplete;
   `make attack`/`make benchmark` therefore use the TypeScript suites directly.

## 8. Troubleshooting

- **`java: command not found`** → install a JDK ≥ 11 (or use the container).
  `make proof` fetches a checksum-pinned `tla2tools.jar` into `.cache/tla/`.
- **`tla2tools sha256 mismatch`** → a proxy/mirror served a different jar; delete
  `.cache/tla/tla2tools.jar` and re-run, or set `TLA_TOOLS_JAR` to a trusted copy.
- **Unit tests time out** → raise `VITEST_TIMEOUT_MS` (default 60000) or run a
  subset: `npx vitest run tests/unit`.
- **`pandoc`/`latexmk` missing** → the PDF stage is optional locally; run it in
  the container: `docker compose -f docker-compose.reviewer.yml run --rm reviewer make dissertation`.
- **DAB bench prints nothing when run directly** → the per-attack files have no
  CLI entrypoint; use `node --experimental-strip-types dab/bench/run_all.ts`.
- **`make reproduce` exits non-zero** → expected at HEAD. Open
  `artifacts/reports/aec_summary.md` and `docs/artifact/repository_inventory.md`
  §7; the report lists exactly which gating stages failed and why.

## 9. Expected outputs

After `make reproduce`:

```
artifacts/
├── reports/aec_summary.json      # machine-readable roll-up (exit-code source)
├── reports/aec_summary.md        # human-readable summary
├── status/*.json                 # per-stage exit/timing/detail
├── proofs/proofs_summary.json    # TLC results + recorded logs
├── attacks/attacks_summary.json  # root security + DAB bench
├── attacks/dab_bench.json        # full DAB bench output
├── benchmarks/*.json             # latency/throughput/overhead
└── logs/*.log                    # per-stage stdout+stderr
docs/dissertation/ghost-ark-usenix.pdf   # only when the claim gate is green
```

The **source of truth for pass/fail** is `artifacts/reports/aec_summary.json`
(`.status` = `PASS`/`FAIL`, with `.gating_failures`). A skeptical reviewer can
inspect every recorded log, replay each TLC run, re-run each suite, and confirm
the report matches reality — which is the entire point.
