# arXiv Endorsement Email — Claim Review and Corrected Draft

Status: outreach draft, 2026-07-16. This file reviews the author's draft
endorsement-request email against the repository's recorded evidence, then
provides a corrected draft. **Nothing here is sent by tooling; sending is the
author's action.**

## Why this review exists

The draft email links directly to this repository. Its recipient is a
security researcher being asked to vouch for the work. Every sentence of the
email that the repository's own artifacts contradict is a credibility cost
paid at the worst possible moment — and several sentences in the draft are
contradicted by the repository's own status headers, inventory, and
non-claim headers. The fix is not to hedge everything; it is to say the true
version, which in most cases is *more* impressive than the inflated one.

## Claim-by-claim corrections

| Draft email said | What the evidence supports | Where |
|---|---|---|
| Ledger gate "[G]uarantees ... absolute replay resistance" | Rejects replays via a spent-tombstone set; `NoReplays` is TLC-checked on a **bounded model**; the Rust implementation now matches the repaired model; a **stated capacity caveat** remains (tombstone pruning at 500,000 entries opens a theoretical window). "[G]uarantee" wording is blocked by this repo's claim scanner as blanket-assurance language; "absolute" is false by the inventory's own caveat. | `docs/artifact/repository_inventory.md` §7.2; `dab/gateway/src/nonce.rs`; `proofs/dab/artifacts/` |
| OCC gate "**Implements** Optimistic Concurrency Control ... **completely resolving** the concurrency starvation paradox" | The OCC gate is **specified, not implemented at runtime**. Its receipt schema (including the serialized π_R read-set) is implemented and tested. The starvation analysis is a design argument with a stated cost (read-set faithfulness, phantom risk) — "completely resolving" overstates it. | `docs/research/STM_ISOLATION_MAPPING.md` status header; `packages/receipt-schema/src/semanticAuditReceipt.ts` |
| Semantic gate "**successfully neutralizing** ... A-CC and adaptive agentic worms before any physical state mutation" | The semantic gate computes a dependence-free Fréchet **upper bound over supplied per-step marginals**; it does not classify content and certifies no detector's hit rate. A-CC is addressed at the **custody layer** (provenance floors), not by the semantic gate. The committee rebuttal states this boundary explicitly. | `docs/research/COMMITTEE_REBUTTAL.md` Critique 4; `evaluateSemanticGate` |
| "**completely deflected** a 10,000-payload 'Brutal' Attack Corpus with **zero leaks**" | Modeled-attacker advantage **0 across four security games × 10,000 trials each**, plus a nine-attack corpus, all detected **in-suite**, in-process, with an explicit non-claim header ("not a proof of safety; says nothing about the TCB under deployment"). | `dab/bench/run_all.ts` header; recorded run 2026-07-16 |
| "successfully **survived** rigorous TLC model checking" | Stronger and true: TLC **refuted the original design** (garbage collection re-enabled replay), the repair landed spec-first, the implementation was brought into conformance, and the counterexample is kept as a permanent mutant regression. To a systems researcher this is the credible story; "survived" erases it. | inventory §7.1–7.2 |
| "dependent Fréchet-Hoeffding bounds" | The implemented bound is the **dependence-free** envelope — its point is exactly that it assumes *nothing* about dependence (sharp under adversarial correlation). "Dependent bounds" muddles the one mathematical claim that is airtight. | `main.tex` §4.2 |
| Business paragraph ("provenance moat", "highly marketable", "appeals ... to compliance regulators and insurers") | Recommend **cutting from this email entirely**. An endorsement request is a scholarly-fit judgment; marketing register works against it, and "appeals to compliance regulators" brushes the repository's compliance non-claim. (Also contains the typo "compliance compliance".) | `CLAUDE.md` non-claims |

## Pre-send checklist (author actions)

1. **Push the claim-gate fix.** The commit currently at public HEAD fails the
   repository's own claim gate (two blanket-assurance violations introduced
   in `docs/paper/main.tex`; fixed in the working tree on 2026-07-16). Do
   not send an email inviting a security researcher to a repo whose own gate
   is red at HEAD.
2. Build and attach (or link) the PDF — endorsers usually want the abstract
   and paper, not just a repo: `bash docs/paper/build.sh`.
3. Confirm Dr. Liu can endorse for **cs.CR** specifically (arXiv endorsement
   is per-archive/category; the code HFEHVA is bound to your request).
4. Consider cross-listing `cs.DC` (the paper's framing is distributed
   systems) — primary cs.CR is defensible either way.
5. Verify the LinkedIn URL renders as intended; consider whether it belongs
   in an academic endorsement request at all (GitHub + PDF usually suffice).

## Corrected draft

> Subject: arXiv endorsement request (cs.CR) — Ghost-Ark: a transactional
> control plane for untrusted AI agents
>
> Dear Dr. Liu,
>
> I hope you have been doing well. I am writing to respectfully request your
> endorsement for an arXiv submission in cs.CR (Cryptography and Security).
> The endorsement code arXiv generated for this request is **HFEHVA**.
>
> I also want to say something honestly: the Independent Research course
> under your supervision reshaped how I approach engineering rigor. It
> taught me to stop being hesitant about my work and instead move with
> discipline toward hard problems. This submission is a direct descendant of
> that course.
>
> It extends the CC-Framework work you supervised — measuring interaction
> effects and failure dependencies in composed AI-safety systems — into a
> system called Ghost-Ark: a transactional control plane for untrusted LLM
> agents. Instead of trusting a model's linguistic compliance, Ghost-Ark
> treats an agent trajectory as a software transaction: the agent executes
> speculatively against an isolated ghost replica G(σ₀), and its effects
> reach the environment only through a three-gate validation pipeline, with
> a signed, canonically serialized receipt emitted on every commit *and*
> every abort.
>
> Because you will read the code, here is the honest status of each gate.
> The **ledger gate** (replay rejection via a spent-tombstone set) is
> TLC-checked as a bounded model *and* wired into the running Rust gateway —
> and I want to be candid that model checking first *refuted* my original
> design: TLC produced a counterexample where garbage collection re-enabled
> replay. The repair landed spec-first, the implementation was brought into
> conformance, and the counterexample is kept as a permanent mutant
> regression. I can show the wired ledger rejecting a replayed nonce over the
> real Unix socket, not just in a unit test. The **semantic gate** (a
> dependence-free Fréchet upper bound on cumulative trajectory failure — no
> independence assumption, which is the point, since guardrail failures
> correlate) is implemented and unit-tested; it bounds supplied per-step
> marginals and deliberately does not classify content itself. The **OCC
> gate** (a read-set projection π_R that recovers liveness from what I call
> the starvation trap) is specified with a tested receipt schema; its runtime
> enforcement is future work, and the paper labels it that way throughout.
>
> Current evidence at HEAD: five TLC-checked bounded models (up to 403,949
> distinct states) with five seeded mutants reproducing their intended
> violations; a recorded, reproducible gateway↔independent-verifier
> round-trip with real ed25519 signatures — the independent verifier accepts
> a gateway receipt and rejects a brutal forgery corpus (tampered field,
> protocol downgrade, non-hex / truncated / all-zero / transplanted
> signatures, wrong key), all demonstrated on Kubernetes as well; the Rust
> crates are `cargo clippy -D warnings` clean; modeled-attacker advantage 0
> across four security games × 10,000 trials plus a nine-attack corpus
> (in-suite, modeled attacker only — the bench's own header states the
> non-claim); ~6.6 μs mean added in-process latency; and a claim-language
> linter that gates the repository's own documentation, including the
> manuscript.
>
> I would value your brutal critique far more than your kindness here —
> especially on Section 4 (the starvation analysis and the Fréchet bound's
> saturation behavior — Figures 2 and 3 plot both) and on anything in the
> evaluation you think is overstated. If it survives you, I'll feel ready for
> the committee.
>
> Manuscript and code:
> - Repository: https://github.com/Cubits11/ghost-ark (paper under
>   `docs/paper/`, one-command artifact reproduction via `make reproduce`)
> - CC-Framework: https://github.com/Cubits11/cc-framework
>
> Thank you for your mentorship, your structural critique, and your
> encouragement. I would be deeply grateful for your endorsement.
>
> Warm regards,
> Pranav Bhave
> bhavepranavwork@gmail.com

## What was deliberately kept

The gratitude paragraph (trimmed, not removed — it is genuine and it is
yours), the CC-Framework continuity framing, the endorsement code, and the
"ask them to break it" posture — which the corrected draft makes explicit,
because it is both the repository's doctrine and the most disarming thing a
former student can say to a skeptical mentor.
