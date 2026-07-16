# Targeted Circulation — Email Template

Status: outreach draft, 2026-07-16. **Sending is the author's action.** This
template is for researchers in systems/security who did *not* supervise the
work (for the endorsement request to Dr. Liu, use
`ENDORSEMENT_EMAIL_REVIEW.md`).

## Doctrine

Do not ask anyone to promote the work. Ask them to break it. Name the
section you believe is weakest and invite the attack there — a researcher
who finds a real flaw becomes invested; a researcher asked for a signal
boost becomes annoyed. Every claim in the email must be one the repository
can back when they clone it, because the good ones will clone it.

## Template

> Subject: Request for brutal critique — OCC model for LLM agent execution
>
> Dear [Name],
>
> I've formulated an optimistic-concurrency-control model for LLM agent
> execution: agents speculate against an isolated replica, and effects
> commit only through a validation pipeline — nonce ledger with
> spent-tombstone semantics (TLC-checked as a bounded model; the model
> checker refuted my first design and the counterexample is kept as a
> regression), a read-set projection to avoid validation starving under
> concurrent environmental writes (specified; runtime enforcement is future
> work and labeled as such), and a dependence-free Frechet bound on
> cumulative trajectory failure (implemented; it aggregates supplied
> marginals and deliberately does not classify content).
>
> I'd value your brutal critique on Section 4 — specifically [pick one:
> whether read-set faithfulness is a defensible assumption for
> tool-calling agents / whether the Frechet bound's saturation makes the
> semantic gate useless at long horizons / whether the bounded-model TLC
> results are being asked to carry more weight than bounded models can].
>
> Preprint: [arXiv link]. Artifact: https://github.com/Cubits11/ghost-ark —
> `make reproduce` is one command in a container and the claim-to-command
> map is README-AE.md. The paper's "Limitations and Non-Claims" section is
> normative; if you catch the paper exceeding it, that is exactly the
> feedback I want.
>
> Thank you,
> Pranav Bhave

## Targeting notes (fill in before sending)

Choose 5–10 people across three bands, and personalize the [bracket] per
recipient — the weakest-section confession must be real for each:

1. **Transactions/databases**: people who will attack the OCC analogy
   itself (isolation-level mapping, phantom handling, validation costs).
2. **Security**: people who will attack the threat model (what the modeled
   attacker omits, the custody layer's SSRF surface, the A-CC framing).
3. **Formal methods**: people who will attack the bounded-model claims and
   the mutant-oracle methodology.

Do not send all three bands the same weakest-section; send each band the
weakness in *their* domain.
