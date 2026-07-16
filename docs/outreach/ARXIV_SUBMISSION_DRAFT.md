# arXiv Submission — Metadata Draft

Status: outreach draft, 2026-07-16. **Submission is the author's action**;
this file only prepares it. Prerequisite: endorsement for cs.CR (see
`ENDORSEMENT_EMAIL_REVIEW.md`).

## Metadata

- **Title:** Ghost-Ark: A Transactional Control Plane for Untrusted AI Agents
- **Primary category:** cs.CR (Cryptography and Security)
- **Cross-list:** cs.DC (Distributed, Parallel, and Cluster Computing);
  optionally cs.SE
- **License:** recommend `arXiv.org perpetual, non-exclusive license` or
  CC BY 4.0 (author's choice; CC BY maximizes reuse, the arXiv license is the
  conservative default)
- **Comments field:** `Draft. Artifact: https://github.com/Cubits11/ghost-ark
  (one-command reproduction via 'make reproduce'; claim-to-command map in
  README-AE.md). Evaluation numbers are recorded runs; see Section
  "Limitations and Non-Claims".`

## Abstract (plain-text, arXiv-ready)

Agentic LLM deployments couple a non-deterministic planner directly to
effectful APIs. The dominant defense — semantic guardrails —
probabilistically flags unsafe content, but enforcement is a question about
state: which bytes may mutate the environment, under which recorded
justification. We present Ghost-Ark, a control plane that treats an agent
trajectory as a software transaction. An untrusted agent executes
speculatively against a ghost replica G(sigma_0); a separate trusted gateway
admits its effects only through a three-gate validation pipeline: a ledger
gate (nonce freshness with spent-tombstone semantics), an OCC gate (hash
equality over a read-set projection pi_R, which restores liveness lost to
global-state validation), and a semantic gate (a dependence-free Frechet
upper bound on cumulative trajectory failure). Every admitted or aborted
transaction yields a signed, canonically serialized, independently
replayable receipt. We report what is implemented and measured, and label
what is only specified. TLC model checking of five bounded models (up to
403,949 distinct states) is clean and five seeded mutants reproduce their
intended violations — including a true-positive replay flaw model checking
exposed in our own garbage-collection design, repaired spec-first and
propagated to the Rust gateway. Against a nine-attack adversarial corpus and
four security games (10,000 trials each), the modeled attacker's advantage
is 0. The in-process enforcement path adds approximately 6.6 microseconds of
mean latency on commodity hardware. Ghost-Ark verifies what was recorded,
signed, policy-bounded, and replayable; it does not certify that any agent
output is true, aligned, or semantically safe.

## Submission checklist (author actions, in order)

1. Working tree at HEAD passes `npm run scan:claims` (the manuscript is
   inside the gate) and `bash docs/paper/build.sh` produces `main.pdf`.
2. Verify the PDF's author block is the **named** block (arXiv is not
   anonymous) — `main.tex` has both blocks; the double-blind one is for
   conference submission later.
3. Upload `main.tex` (+ `main.bbl` if using BibTeX later; the current
   manuscript uses an inline bibliography, so the single `.tex` suffices).
4. Category cs.CR primary; add cross-lists at submission time (they cannot
   be added by readers later).
5. After the arXiv ID exists, add it to the repository README and to
   `docs/paper/README.md`.

## What arXiv posting does and does not do

Posting establishes a public timestamp for the terminology and constructions
(the phrases "agentic OCC", "read-set projection for agent validation",
"semantic control plane" as used here). It is a *priority timestamp*, not a
peer-review outcome, and it does not preclude later conference submission —
but check the target venue's concurrent-submission and anonymity policies
before the conference deadline (USENIX Security and OSDI both currently
tolerate arXiv preprints under specific conditions; re-verify the year's
call for papers before assuming).
