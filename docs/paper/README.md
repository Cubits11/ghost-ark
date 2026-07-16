# docs/paper — Conference Manuscript

`main.tex` is the systems-track conference manuscript for Ghost-Ark's
transactional control plane (distinct from `docs/dissertation/`, which is the
monograph). It is written under the repository claim boundary and is scanned
by the forbidden-claims gate (`.tex`/`.bib` are scannable extensions).

## Evidence discipline

Every empirical number in the paper is defined once, in the **Evidence
Macros** block at the top of `main.tex`, with a comment naming the recorded
run or committed artifact it came from. The claim-to-command map lives in
[`README-AE.md`](../../README-AE.md) at the repository root. If you change a
number, change its evidence pointer or delete the claim.

Numbers currently bound (2026-07-16, repository HEAD):

| Macro group | Source |
|---|---|
| Bench (advantage, latency, throughput) | `node --experimental-strip-types dab/bench/run_all.ts --trials 10000` on Apple M1 / macOS arm64 / Node v22.22.3 |
| TLC distinct-state counts | `artifacts/proofs/proofs_summary.json` + recorded logs under `artifacts/proofs/logs/` and `proofs/dab/artifacts/` (tla2tools v1.8.0) |
| Test counts (640 / 97) | `make unit` at HEAD |
| Claim-gate file count | `npm run scan:claims` at HEAD |

## Build

```bash
bash docs/paper/build.sh
```

The script is fail-closed: it runs the claim-language gate first and refuses
to produce a PDF if the gate is red. It compiles with local `latexmk` if
present, otherwise inside the reviewer container
(`docker compose -f docker-compose.reviewer.yml build` once, first).

## What this paper does not claim

Semantic safety, alignment, compliance, production readiness, verified
implementations (the TLC results are bounded models), live-AWS measurements,
attestation, or any detector's hit rate. Section "Limitations and
Non-Claims" in the manuscript is normative; edits that shrink it should be
treated with the same suspicion as edits that delete tests.
