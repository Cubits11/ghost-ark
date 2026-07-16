# 30-Minute Technical Talk — Outline

Status: outreach draft, 2026-07-16. For university reading groups and
security meetups. Present the math, not the marketing. Every number on a
slide carries its evidence pointer in the footer.

## Shape (30 min = 22 talk + 8 questions)

**[0–3] The epistemic deficit.**
One slide, one sentence: guardrails evaluate *utterances*; operators need a
property of *state mutations*. The question "did the bytes that reached the
environment correspond to an authorized, recorded, non-replayed decision?"
is not answerable by a classifier at any confidence. No product pitch; the
room should recognize a category error, not a startup.

**[3–7] Agents as isolation levels.**
The table: API-coupled loop = READ UNCOMMITTED (dirty writes: pre-abort
steps already leaked); sandbox + intent pool = READ COMMITTED (write skew:
stale reasoning flushed onto shifted state); the missing rung is a
validation phase. This is where the database people in the room sit up —
let them. Credit Kung–Robinson explicitly.

**[7–12] The three gates.**
One slide per gate, each with its status label spoken *out loud*:
- Ledger gate (implemented, Rust; TLC-checked bounded model): freshness,
  spent tombstones.
- OCC gate (specified; receipt schema tested; **not enforced at runtime** —
  say this sentence verbatim, it buys more credibility than any result):
  H(pi_R(sigma_now)) = H(pi_R(sigma_0)).
- Semantic gate (implemented): min(1, sum p_i) as the dependence-free
  Frechet envelope; aggregates supplied marginals; classifies nothing.

**[12–17] The best five minutes: TLC refuted us.**
Walk the counterexample: GarbageCollect removes a consumed nonce; second
agent re-consumes it; NoReplays violated — a true positive about the shipped
design. Show the repair (tombstone set), the mutant kept as regression, the
Rust divergence found *after* (TTL eviction = the refuted behavior), the
conformance fix, and the surviving bounded caveat (tombstone capacity,
500,000). Thesis of the talk lives here: the value of formal methods was a
refutation, not a certificate.

**[17–21] The starvation trap.**
Global validation: commit probability e^(-lambda*d) — for 30 s of reasoning
at one background write/sec, ~1e-13. Perpetual abort. pi_R restricts the
equality to declared dependencies: e^(-lambda_R*d). Then give away the
weakness before anyone asks: read-set faithfulness is an instrumentation
property; predicate reads inherit the phantom problem; and the Frechet
bound saturates at long horizons — the starvation trade reappearing at the
semantic layer.

**[21–22] Numbers slide (one, only one).**
Advantage 0 across 4 games x 10,000 trials (modeled attacker, in-suite —
the caveat goes ON the slide, same font size); ~6.6 us mean added
in-process latency (and why the 1,333% relative figure against a 0.5 us
no-op baseline is a number without decision content); 640 tests; 5 bounded
models + 5 mutants. Footer: `make reproduce`, README-AE.md.

**[22+] The closing sentence.**
"You should not trust me, the README, or the model — you should be able to
replay the digest, verify the signature, map each claim to its evidence,
and reproduce the failure boundary. That's the artifact; break it."

## Q&A traps to prepare (see docs/defense/DEFENSE_ANCHOR.md for full answers)

- "So does this stop prompt injection?" — custody floors make the modeled
  laundering pattern structurally unsatisfiable; confused-deputy-within-
  clearance is explicitly out of scope; never say "stops".
- "Isn't 1,333% overhead disqualifying?" — denominator honesty; absolute
  microseconds vs unmeasured cloud I/O; "fast" is not claimed.
- "Is the TLA+ a proof of the system?" — bounded models of the design;
  implementation conformance is tested, not proved.
- "Why should I believe advantage 0?" — you shouldn't; run it; zero over
  10^4 trials bounds the modeled per-trial rate at ~3e-4 (95%), and says
  nothing outside the modeled family.
