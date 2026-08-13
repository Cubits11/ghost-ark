# External kernel-probe reports — filed 2026-08-12

Dated snapshot. This file records what was **sent**, and will record what comes **back**,
verbatim, including replies that say the report was wrong.

## Why this file is not yet evidence

Plan step 14 asks for one person outside the project to receive the work, and its acceptance
criterion is **"a reply exists"** — not "a report was sent." Five reports were filed on
2026-08-12. Zero replies exist as of that date. **Filing is an action; a reply is the
observation.** A project that counted its own outbound messages as external validation would
be committing the tautology this repository exists to catch, one social layer up.

So the status below is `FILED`, and it stays `FILED` until somebody who does not work on this
project writes something back.

## What makes a reply valuable, ranked

1. **"Your intent is wrong."** A maintainer saying their consumers do not distinguish a pair
   marked `distinct` is the single most valuable outcome available. It is direct evidence
   about the alphabet — the component of E1 that this project can least verify alone, and the
   exact substance of falsifier F2. Record it, and if it holds, the alphabet changes and the
   change is attributed.
2. **"This is real and here is the fix."** Confirms the finding and moves the ecosystem.
3. **"Working as intended, here is why."** A documented consumer boundary. Also a finding: it
   partitions the alphabet by consumer rather than refuting it.
4. **Silence.** The least informative outcome and the most likely one. Record it as silence
   after 30 days rather than deleting the row; an unanswered report is a fact about reach.

## The reports

| # | Target | Kind | Claim | Status |
|:--|:---|:---|:---|:---|
| 1 | `snowyu/json-canonicalize.ts` | Bug, conformance | Serializes `Infinity` as `null` instead of terminating; RFC 8785 §3.2.2.3 MUST. Every literal outside the double range receives one identity. | FILED |
| 2 | `cyberphone/json-canonicalization` | Spec discussion | §3.1 forbids duplicate property names at a layer where no conforming implementation can observe them, because JCS operates on parsed data. | FILED |
| 3 | `BridgeAR/safe-stable-stringify` | Documentation | Non-finite numbers serialize to `null`, so they are indistinguishable when the output is used as a digest input. | FILED |
| 4 | `ljharb/json-stable-stringify` | Documentation | Determinism is not injectivity: non-finite numbers and integers above 2^53 merge. | FILED |
| 5 | `erdtman/canonicalize` | Documentation | The conforming implementation of the five; duplicate keys are resolved by the parser before it runs, which is worth stating. | FILED |

Supporting measurement: [JCS_CANONICALIZER_PROBE.md](../research/JCS_CANONICALIZER_PROBE.md).
Tool: `@ghost-ark/kernel-probe@0.1.0`, installed from the npm registry rather than from this
repository — so every number above was produced by the artifact a stranger would get.

## Disposition log

One entry per reply. Quote the reply verbatim before interpreting it, and write the
disposition even when the disposition is "we disagree."

<!-- template
### R1 — <target>, <date>
**Reply, verbatim:**
> …

**Disposition:** accepted / disputed / superseded / no action
**Change made:** <commit, or "none" with the argument>
-->

_No replies recorded._

## What a reply changes, mechanically

- A **disputed intent** edits `tools/experiments/kernelAlphabet.ts`. That file is
  pre-registered and pinned by a test, so the edit is visible in review and must cite this
  document and the reply. E1's counts are re-derived, not adjusted, and every document
  quoting them fails `measuredFigureConsistency.test.ts` until re-measured.
- A **confirmed bug** in an upstream library changes nothing in this repository except this
  row — the finding was always about them, not us.
- A **spec change** to RFC 8785 would be the strongest possible outcome and would supersede
  the framing in `PROVENANCE_KERNEL_PROBLEM.md` §layering.

## Sweep 2 — 2026-08-12 (later session): considered and NOT filed

A second target sweep — canonical-JSON implementations, JCS libraries, CBOR codecs, and the
in-toto/TUF canonicalization path — was probed locally against latest released versions on
darwin/arm64 (CPython 3.14.6, rustc 1.97.1, Node v22). **It produced zero new reports, and
that outcome is recorded with the same care a filing would get**, because the reasons vary
and two of them are findings in their own right.

| target | version probed | finding reproduced here | why not filed |
|:---|:---|:---|:---|
| `trailofbits/rfc8785.py` | 0.1.4 | int 2^53 refused (`IntegerDomainError`) while float 2^53 serializes; two float-spelled texts (`…993.0` / `…992.0`) collide via `json.loads` rounding | The boundary question is already reported and resolved upstream (their #46, closed by docs PR #47): the safe-integer bound is intended. The float-door collapse happens in the caller's parser, not the library — blaming the library would be the C1 category error. |
| `l1h3r/serde_jcs` | **0.2.0** | 0.1.0 panics on a `todo!()` for every numeric input when serde_json's `arbitrary_precision` feature is unified into the build; 0.1.0 also preserves 2^53+1 exactly, diverging from the ECMAScript reference | **Both defects are fixed in 0.2.0** (2026-03-25): the panic path is implemented and integers now collapse reference-compatibly. Reproducing against the latest release before drafting — hard rule 2 — is the only thing that prevented two stale filings. Their #3 (the 0.1.0 divergence) is still open and appears resolvable; a courtesy confirmation comment is drafted below. |
| `titusz/jcs` | 0.2.1 | `json.loads` gives exact ints; `canonicalize({"a": 9007199254740993})` silently emits `…992` — byte-distinct documents, one digest, with the collapse inside the canonicalizer | Known since 2022 (their #1 → `cyberphone/json-canonicalization#20`); the reference author considered and rejected a guard as RFC-nonconforming, and the packager chose reference fidelity. A documented consumer boundary, category 3 in the ranking above. The README "gotcha" note proposed there was never added — the only residual action, too small to file. |
| `secure-systems-lab/securesystemslib` | 1.4.0 | `encode_canonical` emits raw control characters, so its output is not parseable JSON (`json.loads` fails on it) — the E13 composition hazard for any pipeline that re-parses "canonical JSON" as JSON | Their #158 (open since **2018**) already requests exactly this documentation, and #159 records the full design debate. Nothing new to tell them. |
| `agronholm/cbor2` | 6.1.4 | duplicate map keys decode silently last-wins; decode∘canonical-re-encode merges byte-distinct maps into one digest | The strict option already exists — `loads(..., allow_duplicate_keys=...)`, added via their #282/#283. The permissive default is a decision they made with the issue open in front of them. |
| `matrix-org/python-canonicaljson` | 2.0.0 | none: exact big-int preservation, fail-closed on non-finite | **Null result, reported as one.** No pathology class fired. |
| `epoberezkin/fast-json-stable-stringify` | 2.1.0 | `Infinity`/`NaN` → `null` — the same determinism-is-not-injectivity finding as filed reports 3 and 4 | Last real commit 2023; open issues are dependency-bot noise. A report needs a reader. Also a third instance of an already-twice-filed class adds breadth, not information. |
| `dryruby/json-canonicalization` (Ruby) | — | not probed | Latest gem requires Ruby ≥ 3.0; this host has 2.6 only. **Refused rather than probed against a stale version** (rule 4: refuse, do not degrade). |
| `jq` ∘ CPython codecs (E13's counterexample) | jq 1.7.1 | the composition collapse is real and measured in E13 | Not a component defect in either tool — jq's refusal is correct and the CPython codec is explicit opt-in. E13's own coverage boundary says so; there is no maintainer for a composition. |

Two observations this sweep adds to the record:

1. **The ecosystem's maintainers already know.** Every real defect the E1 alphabet detects in
   these libraries was independently reported by others — in 2018 (securesystemslib), 2021
   (serde_jcs), 2022 (titusz/jcs, cbor2) — and each project chose its position deliberately.
   The five Sweep-1 reports remain this project's marginal contribution; Sweep 2's
   contribution is the confirmation that the disagreement between implementations is
   *documented policy divergence*, not ignorance.
2. **Three JCS implementations, three verdicts on one document.** On
   `{"a":9007199254740993}`: `rfc8785.py` **refuses**, `titusz/jcs` (and the JS reference,
   and `serde_jcs` ≥ 0.2.0) **collapses** to `…992`, `serde_jcs` 0.1.0 — still 2.3M
   downloads — **preserves** it exactly. Same RFC, same input, three canonical outcomes:
   `Sound(C, Σ, P)` disagreement at the implementation-population level, and a digest
   produced by any one of the three is unreproducible by at least one of the others.

### Drafted, not sent — courtesy confirmation for `l1h3r/serde_jcs#3`

> Measured with serde_jcs 0.2.0 / serde_json 1.x (default features and `arbitrary_precision`)
> on rustc 1.97.1: `{"a":9007199254740993}` now serializes as `{"a":9007199254740992}` and
> `{"a":18446744073709551615}` as `{"a":18446744073709552000}`, matching the ECMAScript
> reference implementation. The divergence this issue reports reproduces on 0.1.0 but not on
> 0.2.0. It may be closable.

## Non-claim

Five reports filed by one author to five projects is not a random sample of the ecosystem,
not a survey, and not evidence that these libraries are defective in any sense beyond the
specific pairs named. The Sweep-2 table above is likewise not a survey: targets were chosen
by reachability from this host's toolchains, and "not filed" means "nothing actionable to
tell this maintainer today", not "nothing wrong anywhere". Nothing here establishes that the
alphabet generalizes; that is F2 and it remains open until the replies say otherwise or a
real-traffic corpus exists.
