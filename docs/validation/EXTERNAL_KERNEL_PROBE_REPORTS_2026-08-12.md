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

## Non-claim

Five reports filed by one author to five projects is not a random sample of the ecosystem,
not a survey, and not evidence that these libraries are defective in any sense beyond the
specific pairs named. Nothing here establishes that the alphabet generalizes; that is F2 and
it remains open until the replies say otherwise or a real-traffic corpus exists.
