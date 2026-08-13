# Blindness Protocol for an Independent Verifier Implementation

Recorded **2026-08-12**, at suite version 0.1.0, **before any independent implementation
exists**. That ordering is the point: a protocol declared after an implementation can be
fitted to whatever the implementation happens to have seen. This document may be extended,
but the rules below may not be weakened retroactively for any implementation already begun.

## Purpose

Open gap #10 (EXPERIMENTS.md): every existing Ghost-Ark verifier was written by this
project's authors from one reading of the rules, so their agreement cannot detect a shared
misreading. An implementation counts against that gap only if its author demonstrably worked
from the published specification rather than from this project's code. This protocol defines
"demonstrably" honestly — including where it cannot be demonstrated.

## The blindness boundary

A blind implementer MAY access exactly the published conformance artifact:

- `SPEC.md`, `conformance.json`, `fixtures/`, `run-conformance.mjs`, `README.md`
  (equivalently: the published `@ghost-ark/receipt-conformance` package).

A blind implementer MUST NOT access:

- `verifiers/` (node, python, thirdparty), `packages/` (in particular
  `enforcement-runtime` and `receipt-schema`), `tools/experiments/`, or any other source
  file of this repository;
- any prior write-up, conversation, or issue that quotes those sources;
- any other party's implementation produced under this protocol.

Questions from the implementer are permitted and must be answered **only** by amending
`SPEC.md` (a question revealing an ambiguity is a finding about the specification; answering
it privately would fork the spec into a written half and an oral half). Every such amendment
bumps the suite version and is recorded in git.

## Before the implementation starts, record:

1. implementer identity (or model identity and exact version, for the LLM route);
2. the route: course assignment, challenge, another lab, or LLM-from-specification;
3. the suite version and the commit hash of the artifact given to the implementer;
4. the date, and this protocol's version.

The record lives in `docs/validation/` as a dated file, committed before the first line of
the implementation is written.

## Verifiability tiers — what can and cannot be proven afterwards

Blindness has different evidentiary ceilings per route, and the result label MUST carry its
tier. Claiming a stronger tier than the route supports is a protocol violation.

| tier | route | what is verifiable after the fact |
|:---|:---|:---|
| **transcript-verifiable** | LLM given only the artifact in its context | The full prompt transcript is preserved and published, its hash committed before the result is scored; anyone can confirm the context contained only the permitted files. **Residual, stated plainly:** this repository is public, so a model trained after it became public may have memorized the reference verifiers. A clean transcript bounds what was *supplied*, not what was *known*. The label for such a model is `transcript-verifiable, training-contaminable`, and the result is weaker evidence than the same transcript from a model whose training predates the repository's publication. |
| **attested-blind** | human implementer (student, lab, challenge participant) | Nothing, beyond a signed statement. A person's reading history is not auditable, and this protocol does not pretend otherwise. The attestation is recorded verbatim; the result label is `attested-blind`. |

There is no fully-verifiable tier for human implementers. If that ceiling is unacceptable
for a given claim, the claim must not be made.

## Scoring

The implementation is run through `run-conformance.mjs` unmodified. All three levels are
reported, including `not-evaluated` ones. Every disagreement is a finding with three possible
attributions, and the third is the valuable one:

1. an implementation bug (fix it, re-run, record the iteration count);
2. a specification ambiguity (amend SPEC.md, bump the version, re-run);
3. **a divergence between the specification and the reference implementations** — the shared
   misreading E14 could not detect. This is the outcome the whole exercise exists to surface,
   and it is reported as a finding against the references, never reconciled silently.

The number of conformance-harness iterations before first full conformance is recorded: an
implementation that conformed on iteration 1 and one that was debugged against the suite for
forty iterations are different evidence, because the latter has partially fitted itself to
the vectors.

## What a conformant blind implementation would and would not establish

It would close open gap #10 **for the rule set at the recorded suite version**, at the
recorded tier. It would not establish that the rules are complete or correct, that the
specification matches this project's intent, or anything about receipt truth. If the tier is
`attested-blind` or `training-contaminable`, the gap is *narrowed at that tier*, and the open
gap entry is updated to say exactly that rather than "closed".

## Non-claim

No implementation produced under this protocol exists as of 2026-08-12. Nothing in this
document is evidence; it is a commitment device recorded before the evidence, so that the
evidence, if it ever exists, cannot be quietly re-graded.
