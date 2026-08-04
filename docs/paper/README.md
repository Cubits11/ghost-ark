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

Numbers currently bound (measured 2026-08-02, repository HEAD):

| Macro group | Source |
|---|---|
| Verification cost (p50 + IQR, baseline ratios) | `npm run experiment:e2` on Apple M1 / darwin arm64 / Node v22.22.3 |
| Corpus detection (`\evthree*`) | `npm run experiment:e3`; load-bearing verdict from `npm run experiment:e4` |
| TLC distinct-state counts, baselines **and** mutants | `artifacts/proofs/proofs_summary.json` + recorded logs under `artifacts/proofs/logs/` and `proofs/dab/artifacts/` (tla2tools v1.8.0) |
| Test counts (1,253 / 162) — commit-relative, see `main.tex` macro comment | `npm test` at HEAD |
| Claim-gate file count (838) — commit-relative, like the test count | `npm run scan:claims` at HEAD |
| Model-internal only (`\globaladvantage`, `\benchtrials`) | `dab/bench/formal_games.ts` — a calculation over its own declared attacker model, **not** a measurement of this system |

> **`dab/bench/` is quarantined and must not be used to bind a number here.**
> Until 2026-08-02 the bench supplied this paper's advantage, latency, and
> throughput macros; its own README states it is not evidence about Ghost-Ark.
> See §"Superseded evidence" in `main.tex` and retraction **R10** in
> `docs/research/EXPERIMENTS.md`. `tests/unit/repo-hygiene/paperEvidenceSource.test.ts`
> now fails the build if the manuscript cites it without disclosure.
>
> Note also that the macro discipline described above covered TLC *baselines*
> and not TLC *mutants*, which were inline literals — so only the mutant counts
> drifted (61/240/232 against a recorded 63/396/221). Bind every number, not
> most of them.

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
