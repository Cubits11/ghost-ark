# Public Interface

Tier: **core**.

This repository is published under an institutional account. That changes what it
is: not a working directory made visible, but an artifact an institution's name
is attached to. This page states what belongs on the public surface, what does
not, and which of those rules are enforced by tests rather than by intention.

**Status of that sentence, stated precisely.** At the time of writing the remote
is still `Cubits11/ghost-ark`, a personal account. Everything below describes the
rules the repository is held to *in preparation for* the move, and every one of
them is enforced now. The move itself has an unusual property worth naming: an
account boundary is not a code change, so nothing in this repository's own CI
could have told it that a job was about to break. One did — see "Before the
move".

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

## Before the move

Findings from the 2026-08-06 pre-migration audit. Each was verified by running
something, and each is stated with what was actually checked.

**Push `main` explicitly. Never `--all`, never `--mirror`.** Six local branches
are not on `origin`, and one of them — `backup/pre-empirical-audit-d61062a` —
contains commit `47d3c55`, which adds a `.env.example` holding a real-format
Google `GEMINI_API_KEY` (53 characters, `AQ.`-prefixed). It is **not** reachable
from `main` and **not** on `origin`, so it is not public. A mirror push publishes
it in one step, under an institutional name, with the author's attribution on the
commit.

```
git push <psu-remote> main          # transfers only the verified history
git push <psu-remote> --all         # DO NOT: carries the branch above
```

Measured with gitleaks 8.30.1 on 2026-08-06: `main` returns **0 findings** over
its full history; all refs together return **1**, and that one is the branch
above. The `gitleaks` CI job now scans full history on every push, so this is
guarded going forward rather than remembered.

**The 19 dependabot branches on `origin` must be deleted before the repository
moves, not after.** They fork from the pre-rewrite history, so each one carries
**1,547 build-artifact blobs — the full 633 MB** that was purged from `main` on
2026-08-06 (see below). A transfer moves every server-side ref, so leaving them
in place re-imports the bloat into the lab organisation and makes the purge
cosmetic. They are also already broken: their base commits no longer exist after
the history rewrite, and Dependabot regenerates them against the new `main`
within a day.

**History rewritten 2026-08-06, before the move rather than after.** All 230
commits are preserved and the working tree is byte-identical — `main`'s tree hash
was `1d0aad7…` before and after both passes. What changed is metadata and dead
weight:

| | Before | After |
|:--|:--|:--|
| Author identities | 2 (one a personal free-mail address) | 1, the maintainer's GitHub no-reply |
| Commit messages naming an assistant tool | 12 | 0 |
| Build-artifact blobs in history | 1,300 (**633.8 MB of 648.9 MB — 97.7%**) | 0 |
| Push payload | 141 MB, and it failed on a broken pipe | 2.5 MB |

The build artifacts were `dab/gateway/target/` and `dab/verifier/target/`,
committed once and untracked later; `**/target/` has been in `.gitignore` since,
and nothing under it is tracked today. Untracking a directory does not remove its
blobs from history, which is why a repository whose largest tracked file is a
0.28 MB lockfile was still shipping a 51 MB compiled binary to every cloner.
`tests/unit/repo-hygiene` already forbids tracked build output in the working
tree; it cannot see history, so this was invisible to it.

**Rotate that key regardless of what is pushed.** It sat in a working tree and in
local history; treat it as disclosed. Rotation is not something this repository
can verify, so it is listed here rather than claimed anywhere.

**The secret scanner had to be replaced to survive the move.**
`gitleaks/gitleaks-action@v2` requires a licence key for repositories owned by an
organisation and none for a personal account. It ran green here for months and
would have failed on the first push under the organisation — a licensing error on
the one job whose silence is most expensive. It is now the pinned CLI, which has
no such condition. The general lesson is in
[CI_COVERAGE.md](./CI_COVERAGE.md): a CI result measured under one account type
is not evidence about another.

**Three things still name the personal account and must be re-pointed after the
move**, none of which any test can decide for you:

| What | Where |
|:--|:---|
| `repository-code` | [CITATION.cff](../../CITATION.cff) |
| `curl` install line for `kernel-probe` | [README.md](../../README.md), [KERNEL_PROBE.md](../research/KERNEL_PROBE.md), `tools/kernel-probe/` |
| Every owner entry (`@Cubits11`) | [.github/CODEOWNERS](../../.github/CODEOWNERS) |

CODEOWNERS is the one with a silent failure mode: GitHub ignores an owner who
lacks write access to the repository, and it does not report an error for it. If
the account is not carried into the organisation with write access, every review
requirement in that file stops applying and the file still looks correct. Verify
by opening a pull request that touches `packages/enforcement-runtime/src/receipts/`
and confirming a reviewer is actually requested.

**Two organisation settings decide whether CI runs at all**, and neither is
visible from inside the repository:

- *Actions permissions.* An organisation set to "allow actions created by GitHub
  and select non-GitHub actions" blocks every third-party action here —
  `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `hashicorp/setup-terraform`,
  `aws-actions/configure-aws-credentials`, `sigstore/cosign-installer`,
  `anchore/sbom-action`. Every one is now pinned to a commit SHA, which is the
  form an allowlist can be written against; supply the list above to whoever
  administers the organisation.
- *Default workflow token permissions.* Every workflow here declares its own
  `permissions:` block, so a restrictive organisation default is safe. Nothing
  relies on the inherited default being permissive.

**The manuscript's correspondence address is a placeholder.**
`docs/paper/main.tex` previously carried a personal free-mail address; it now
points at the repository. Substitute the institutional address before any
submission or preprint.

## Contact

Security reports go through GitHub Security Advisories for this repository — see
[SECURITY.md](../../SECURITY.md). Citation metadata is in
[CITATION.cff](../../CITATION.cff). Contribution rules, including the invariants
that must not be weakened, are in [CONTRIBUTING.md](../../CONTRIBUTING.md).
