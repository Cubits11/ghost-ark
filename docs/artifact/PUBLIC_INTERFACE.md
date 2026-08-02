# Public Interface

Tier: **core**.

This repository is published under an institutional account. That changes what it
is: not a working directory made visible, but an artifact an institution's name
is attached to. This page states what belongs on the public surface, what does
not, and which of those rules are enforced by tests rather than by intention.

## The five things a reader must be able to reach

Everything else is supporting detail. If a reader cannot get to these five from
the README in one hop, the repository has stopped being self-describing.

| | Question | Where |
|:--|:---|:---|
| 1 | **What is claimed?** | [00_THESIS.md](../research/00_THESIS.md) — one page, with the conditions that would refute it |
| 2 | **How do I check it?** | [EXPERIMENTS.md](../research/EXPERIMENTS.md) — every number with the command that produced it |
| 3 | **What is *not* claimed?** | [non-claims.md](../compliance/non-claims.md), enforced by `npm run scan:claims` |
| 4 | **What is unverified?** | [CI_COVERAGE.md](./CI_COVERAGE.md) and [STATUS_AND_LIMITATIONS.md](./STATUS_AND_LIMITATIONS.md) |
| 5 | **What is reusable without trusting this project?** | [KERNEL_PROBE.md](../research/KERNEL_PROBE.md) |

Item 5 is the one most likely to matter to somebody else. `kernel-probe` takes
any canonicalizer and reports which distinctions it destroys; it needs no
receipt, no AWS, and no agreement with anything else here.

## What does not belong on the public surface

Each rule below exists because the repository violated it. Each is enforced by
`tests/unit/repo-hygiene/publicInterface.test.ts` — prose asking contributors to
be careful is not a control.

**Career correspondence.** Endorsement requests, circulation drafts, submission
letters. A person's professional life is not a research output, and these carry
personal contact details into a public index. `docs/outreach/` (4 files, one
containing a personal email address) was removed.

**Commercial planning.** Go-to-market analyses, capitalization strategy,
underwriting models, pricing. Under an institutional account these invite a
question about whether the affiliation is supporting a venture — a question that
is expensive to answer and free to avoid. A document titled "Go-To-Market &
Series-A Capitalization Strategy" was removed, along with a cyber-insurance
underwriting model and a product vision comparison. Classifying them
`non-research` had been the previous control; a tier label does not make
commercial planning appropriate in a lab repository.

**Developer machine state.** Absolute home-directory paths leak a username and
local layout, and they weaken committed artifacts: a recorded TLC proof log that
names one machine is describing that machine as much as the run. Eleven tracked
files carried one developer's home path, including every proof log. All were
rewritten to `<REPO_ROOT>` / `<TMPDIR>` tokens.

**Self-assigned grades.** A summary score has no rubric, no denominator, and no
external validation — the exact shape of claim this repository's own reporting
rules forbid. Under an institutional account it also reads as the *institution*
grading the work. `SELF_ASSESSMENT.md` became
[STATUS_AND_LIMITATIONS.md](./STATUS_AND_LIMITATIONS.md): same evidence, same
unflattering findings, no score, and the limitations moved ahead of the results.

## What stays, and why

**Unflattering findings stay.** The repository documents CI failing for 40+
consecutive runs while a document claimed the opposite, a fabricated attestation
pass, a pinned hash that verified nothing for sixteen days, and a shell injection
this project introduced. Removing those would be the opposite of
professionalising — a public artifact that records only its successes is making a
claim about itself that its own evidence does not support.

**Retractions stay, listed rather than deleted.** EXPERIMENTS.md carries a
retractions table. A quietly removed claim is indistinguishable from a claim that
was never made.

**Academic work product stays, tiered.** Dissertation chapters, defence
preparation, and validation audits are research artifacts. They are indexed in
[RESEARCH_INDEX.json](../research/RESEARCH_INDEX.json) with an explicit tier so a
reader can tell a core result from an exploratory draft. Seven of forty documents
are core.

## Register

Documentation is written in the third person about the artifact, not the first
person about the author. "The census refuses to emit a degraded report" rather
than "I made it refuse". First-person appears only where a document quotes a
reviewer's voice.

No emoji, no decorative symbols, no status badges asserting properties that are
not measured. Tables and prose only.

Numbers carry their denominators, their host, and their provenance. A proportion
without a denominator is not reportable here, and neither is a grade.

## Contact

Security reports go through GitHub Security Advisories for this repository — see
[SECURITY.md](../../SECURITY.md). Citation metadata is in
[CITATION.cff](../../CITATION.cff). Contribution rules, including the invariants
that must not be weakened, are in [CONTRIBUTING.md](../../CONTRIBUTING.md).
