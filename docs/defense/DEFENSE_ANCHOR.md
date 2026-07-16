# Dissertation Defense Anchor — The Evidence Kernel

Status: defense preparation document, 2026-07-16. Companion to
`docs/dissertation/` (the monograph), `docs/paper/` (the conference
manuscript), and `README-AE.md` (the claim-to-command map). Every answer
below cites the artifact that backs it; an answer with no artifact is a
concession, and the remaining ones are listed deliberately in §3.

> **§0. Brutal-readiness addendum (2026-07-16).** Two questions a hostile
> committee would have won last week are now closed with recorded evidence,
> and one honest correction was made in the process:
>
> - *"You proved a tombstone replay model in TLA+. Does your gateway actually
>   run it, or is that code decoration?"* — It runs it. The verified
>   `ReplayLedger` (`nonce.rs`) was **orphaned** (never compiled into the
>   binary; the gateway used an inline `HashSet`). I found that, said so in
>   the inventory, and then **wired it in**: `main.rs` now calls
>   `ReplayLedger::consume()`, and a full socket E2E over `/ipc/dab.sock`
>   shows a replayed nonce answered `REPLAY_REJECTED` by that ledger
>   (`dab/roundtrip/RECORDED_SOCKET_E2E.txt`). The find-and-disclose-then-fix
>   sequence is itself the argument: the repository caught its own overclaim.
> - *"Show me the untrusted agent driving the gateway over the real socket,
>   not a hermetic shortcut."* — `dab-agent` (`gateway/src/bin/dab-agent.rs`)
>   does exactly that; the certified path is independently `VERIFIED`
>   in the same transcript, and the whole gateway/verifier is
>   `cargo clippy -D warnings` clean.
> - *Correction made along the way:* earlier docs (and prior notes) implied
>   the running binary already implemented the verified tombstone model. It
>   did not, until today. That is now stated plainly (inventory §7.2/§7.5).

## 1. The kernel

When the committee pushes out of bounds — hallucination rates, training-data
contamination, "but is the model safe?" — the defense is one move, stated
without defensiveness:

> Ghost-Ark does not fix the LLM, and does not measure it. It takes the
> model's fallibility as an axiom and changes what a fallible plan can touch:
> the agent speculates against an isolated replica, its effects reach the
> physical environment only through a validated commit, a failed validation
> collapses the speculation before anything physical mutates, and every
> decision — commit or abort — leaves a signed, independently replayable
> receipt. Questions about the model's internals are upstream of this
> boundary by construction; that is not a limitation of the thesis, it *is*
> the thesis.

Precision note (do not paraphrase into error): Ghost-Ark discards
**speculative, uncommitted** effects. It does not roll back committed
physical writes — nothing does, which is exactly why the validation phase
sits *before* the commit. If a committee member says "so it undoes what the
agent did," the correction is: it prevents the doing; what it cannot prevent
it evidences.

## 2. The attack tree — anticipated pushes, bounded answers

**"What is the hallucination rate of the underlying model?"**
Not measured, not claimed, upstream of the boundary. The architecture is
indifferent to the rate: a 0.1% and a 30% hallucination rate produce the same
enforcement semantics, different abort frequencies. The liveness analysis
(manuscript §4.1) is where rate matters, and it enters as an abort-rate
parameter, not a safety parameter.

**"Could training contamination make the agent collude with the attacker?"**
Yes, and the design assumes it: the agent runtime is modeled as compromised
(threat model §2). Collusion changes nothing about floor satisfiability —
fabricated in-context text still carries no gateway envelope. What collusion
*can* do within an authorized clearance is the confused-deputy limitation,
conceded in print (manuscript §2.4; dissertation ch. 10).

**"Your TLA+ 'proves' the system?"**
No — bounded models of the design, and the word used everywhere is
"TLC-checked", not "verified implementation". The strongest formal claim we
make is a *refutation*: TLC produced a counterexample against our own
baseline (GC re-enabled replay), the repair landed spec-first, the
implementation was brought into conformance, and both oracle directions
(clean baseline, violating mutant) are committed regressions.
Evidence: `proofs/dab/artifacts/`, inventory §7.1–7.2, `make proof`.

**"Attacker advantage 0 — so it's secure?"**
Advantage 0 over 4 games × 10,000 trials under the modeled attacker,
in-suite, in-process. A zero numerator over 10⁴ trials bounds the modeled
per-trial rate below ≈3×10⁻⁴ at 95% confidence and says nothing outside the
modeled family — the bench's own header states the non-claim. If the
committee wants the sentence: "the modeled channels are closed; unmodeled
channels are unmeasured."
Evidence: `dab/bench/run_all.ts`, README-AE row 2.

**"1,333% overhead is disqualifying."**
The denominator is a 0.5 µs no-op dispatch. Absolute added cost is ≈6.6 µs
mean in-process — beneath measurement noise next to any real tool call, and
the honest converse is stated in the same breath: cloud I/O and KMS latency
are unmeasured; "fast" is not claimed. (Manuscript §5.3 makes this argument
in full; do not let a percentage discussion proceed without renaming the
denominator.)

**"The OCC gate is not implemented. Is this vaporware?"**
The paper labels it [specified, not enforced at runtime] in the
contributions list, the architecture section, and the limitations — the
receipt schema including the serialized π_R read-set is implemented and
tested. The defended contribution is the *analysis*: why global validation
starves, what the projection recovers, and what it costs (read-set
faithfulness, phantom exposure). An implemented-but-unanalyzed gate would be
worth less to the field than an analyzed-and-labeled specification.

**"The semantic gate is garbage-in, garbage-out."**
Correct, by design, and stated in print. It computes the dependence-free
Fréchet envelope over supplied marginals — the unique bound valid under
every dependence structure, including adversarial correlation, which is the
CC-Framework's entire subject. The alternative (independence assumptions)
is not more rigorous; it is quietly wrong in exactly the correlated-failure
regime that matters. Saturation at long horizons is likewise conceded and
analyzed (manuscript §4.2).

**"Why is there no InjecAgent number in the evaluation?"**
Because we did not re-run InjecAgent, and the paper says so explicitly
rather than converting a published 47% baseline plus a structural argument
into a fake "47%→0%" measurement. What is claimed: under the modeled floor
semantics, the laundering pattern is structurally unsatisfiable, evidenced
by scenario tests. A live replication behind the gateway is named future
work — offer it to the committee as the first post-defense experiment.

**"The tombstone set is finite. So replay is possible."**
Yes: pruning at 500,000 entries opens a theoretical window for nonces older
than both TTL and capacity — stated in the inventory, the manuscript, and
here. The production posture (durable conditional-write store) is named and
explicitly not implemented. This is the model answer for the whole defense:
concede fast, cite where it was already conceded in print, name the path.

**"Why no enclave/attestation story?"**
Refused until an implemented, tested AWS-supported flow exists — recorded
as a refusal in `docs/architecture/ACC_ENFORCEMENT_ARCHITECTURE.md`
(disposition: "enclave-attestation posture ahead of an implemented flow").
Signing proves authorization over bytes, not runtime integrity.

**"What exactly is novel here?"**
Four things, each with lineage named: (1) the isolation-level mapping of
agent loops and the identification of the missing validation phase
(Kung–Robinson applied to a stochastic client); (2) the starvation analysis
and π_R's liveness/detection trade; (3) the dependence-free Fréchet trigger
as the semantically honest gate under correlated guardrail failure; (4) the
mutant-oracle TLC discipline with the recorded self-refutation. The receipt
layer is deliberately positioned as Certificate-Transparency-shaped, not
claimed as novel cryptography.

## 3. Deliberate concessions (say them before the committee does)

1. No live-AWS evidence anywhere in the defended claims; the gateway signs
   with a local DEV ed25519 key, not KMS/HSM/TPM/Nitro. (The
   gateway↔verifier round-trip that *was* a concession here is now closed and
   recorded — §0 — so the honest residual shrinks to key custody, not the
   receipt path.)
2. `receipts.rs` and `gateway/src/verifier.rs` remain orphaned parallel
   surfaces (dead code); the live paths are `GatewayReceipt` in `main.rs` and
   the `dab-verifier` crate. The TypeScript `dab/agent-runtime/` library is
   still unwired (the exercised agent driver is the Rust `dab-agent`).
3. Single-node everything: no consensus, no replication, no availability
   story. That is Tier-1 (below), not the defended system.

## 4. Future-work map — Tier-1 and beyond (research-only, aspirational)

Everything in this section is labeled **research-only / aspirational** under
the repository's AWS-reality-boundary discipline: none of it is implemented,
none of it is claimed, and citing this section as capability is a
claim-boundary violation.

- **Tier-1: replicated ledgers for agent fleets.** The single-writer nonce
  ledger and receipt log become replicated state machines (Raft for the
  implementation-friendly path; Paxos-family for the treatment of
  reconfiguration). The interesting research object is not "run Raft" but
  the interaction of consensus with the gates: a spent-tombstone set as a
  replicated log compaction problem (tombstone pruning becomes a *joint*
  consistency/capacity decision); π_R validation reads as leader-local
  vs. quorum reads (staleness reopens exactly the TOCTOU the ledger gate
  closes — the read-set projection must be causally consistent with the
  commit point); and cross-agent conflicts, where two agents' read-sets
  overlap and OCC ordering across a fleet becomes a distributed
  serialization problem with a non-deterministic client on every node.
- **Receipt v2 binding**: gateway-envelope digests bound into decision
  receipts (the migration named in `ACC_DEFENSE_INQUIRIES.md`), giving one
  chain of custody from tool bytes to committed action.
- **OCC gate runtime enforcement** with instrumentation-derived read-sets,
  and an empirical study of read-set faithfulness in real tool-calling
  traces (how narrow is too narrow before conflicts slip through).
- **Live InjecAgent replication** behind the gateway — the honest version of
  the number the field will keep asking for.
- **Durable tombstone store** (conditional writes) closing the capacity
  caveat, with measured cloud-mode latency replacing the unmeasured-I/O
  non-claim.
- **Model↔implementation conformance testing** generated from the TLA+
  models (model-based test generation), narrowing the "bounded models, not
  verified implementations" gap from both sides.

## 5. The closing statement (memorize the shape, not the words)

> A skeptical reviewer should be able to say: I do not trust the author, the
> README, or the model. And then: replay the canonical digest, verify the
> signature, map each claim to its evidence, inspect the non-claims, and
> reproduce the failure boundary — including the failures this repository
> published against itself. The contribution of this dissertation is not
> that the system is safe. It is that the system's claims are checkable, its
> refutations are recorded, and its boundary is engineered as carefully as
> its mechanism.
