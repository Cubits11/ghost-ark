# The Löbian Boundary: Why Ghost-Ark Records What It Cannot License

Status: research note (Q1 of the provability program), 2026-07-17. Every claim
below is bound to a committed artifact: the decision procedure and receipts in
`packages/research-frontier/src/lobian/` (42 tests), the recorded run in
`packages/research-frontier/src/lobian/RECORDED_LOBIAN_DEMO.txt`.

Reproduce:

```bash
npx vitest run tests/unit/research-frontier/lobian/
npx ts-node packages/research-frontier/src/lobian/demo.ts
```

## 1. The licensing problem

An agent `A` wants to delegate: it will license a successor `A'` — a modified
policy, a self-rewrite, a spawned subagent — provided `A'` preserves a safety
invariant `φ` (for the demo: `fail_closed`, "every governed invoke fails
closed"). The intuitive demand an operator makes is: *prove the successor is
safe before you license it.*

Formalize the demand. Read `□ψ` as "`A'` proves `ψ`" and ask what `A` would
need as a theorem. Three candidate obligations:

| # | Obligation | Formula | Meaning |
|---|---|---|---|
| 1 | naive soundness | `□φ → φ` | if the successor proves the invariant, it holds |
| 2 | consistency | `¬□⊥` | the successor never proves a contradiction |
| 3 | Löbian self-trust | `□(□φ→φ) → □φ` | trusting its own soundness yields provability |

## 2. The model, and its exact scope

These questions live in Gödel–Löb provability logic (GL): the propositional
modal logic that is sound and complete for finite, transitive, irreflexive
Kripke frames, and — by Solovay's arithmetical completeness theorem — exactly
the provability logic of Peano arithmetic and its arithmetically sound,
recursively axiomatized extensions.

**Scope stated before use:** the modal reading applies to a successor exactly
insofar as its "proves" predicate satisfies the Hilbert–Bernays–Löb
derivability conditions. This note models *proof-based licensing
architectures*; it asserts nothing empirical about the internals of any
particular learned system. That is a boundary, not a hedge: the theorem cuts
wherever "license by proof" is the mechanism, and only there.

## 3. The verdicts, run rather than recited

The repository's GL decision procedure (sound, complete, terminating tableau;
every countermodel independently re-validated by a separate model checker)
returns, on the three obligations (recorded run, deterministic digests):

| Obligation | Verdict | Witness | Receipt digest |
|---|---|---|---|
| `□φ→φ` | **LICENSE_REFUTED** | 1-world countermodel | `sha256:8ed58452…f14c921` |
| `¬□⊥` | **LICENSE_REFUTED** | 1-world countermodel | `sha256:6dd3c167…adc11e4` |
| `□(□φ→φ)→□φ` | **LICENSE_CERTIFIED** | closed proof tree | `sha256:f56f9f83…644a1048` |

The refuting countermodel deserves to be looked at, because it is almost
embarrassingly small: a single world `w0` with **no successors** and `φ` false.
At an endpoint, `□φ` is vacuously true while `φ` fails — so `□φ→φ` fails; and
`□⊥` is vacuously true — so `¬□⊥` fails. One world. The demand "your proof
implies truth" is defeated not by an exotic pathology but by the nearest
possible frame. (Decision cost on these formulas: 2–5 tableau nodes, <1 ms —
recorded; GL-satisfiability is PSPACE-complete in general, and no throughput
property is claimed.)

Obligation 3 is the sharpest instrument: Löb's theorem **is** provable — and
that is bad news, not good. `□(□φ→φ)→□φ` says that if the successor can prove
its own soundness for `φ`, what follows is only `□φ` — *provability* of the
invariant, never the invariant. Self-trust collapses into more self-reference.
Formalized consistency is the special case `φ = ⊥`: `□(□⊥→⊥)→□⊥` is a theorem
(the demo suite checks it), which is Gödel's second incompleteness theorem in
modal dress.

## 4. What is refuted — and what is not

**Refuted:** any licensing architecture in which an agent certifies a
same-proof-strength successor by proving the successor's soundness (`□φ→φ`) or
consistency (`¬□⊥`). Under the stated reading this is not an engineering
shortfall to be closed by a better prover; the obligations are non-theorems of
the logic that governs provability itself. A research program whose safety
story *requires* those proofs is, to that exact extent, a mathematical dead
end.

**Not refuted — the escape hatches, each with its price:**

1. **A strictly stronger verifier** `T'` can prove `Con(T)`. Price: regress —
   who licenses `T'`? The hierarchy must terminate in something *trusted
   without proof* (hardware, an institution, a human), i.e., in an anchor, not
   a theorem.
2. **Decidable fragments.** Bounded, decidable predicates over concrete
   artifacts — digest equality, nonce freshness, schema validity, frame
   conditions — are checkable outright and do not engage Löb. Price: they are
   properties of *records*, not of the successor's future semantic behavior.
3. **Empirical evidence.** Testing and measurement give bounded, non-universal
   support. Price: no universality — exactly the price this repository's
   evaluation sections already state.
4. **Recording.** Emit a verifiable account of what was decided, on what
   evidence, with the refutation witness attached. Price: none of the above is
   pretended.

## 5. The Ghost-Ark position

Ghost-Ark's three-gate pipeline is built entirely inside hatch 2: ledger
freshness, commitment equality (`Δ_DE = 0`), and a dependence-free bound over
*supplied* marginals are decidable checks over concrete artifacts. No gate
asks for — or claims — a soundness proof of any agent. This note is the
theoretical reason that restraint is not modesty but necessity: **the proof
that was "missing" is unavailable in principle, so the honest system converts
the missing proof into a present record.**

Concretely, when a licensing obligation of the Löbian shape is posed anyway,
the engine decides it and the boundary emits either:

- `LICENSE_CERTIFIED` with a proof-tree digest (obligation 3 — with the note
  that it certifies provability, not truth), or
- `LICENSE_REFUTED` with the **finite countermodel embedded in the receipt**.

The receipt's verifier does not trust the signer: it re-runs the independent
model checker on the embedded countermodel (`evidence_replays`). The mutation
suite includes the decisive case: an attacker who doctors the countermodel
(adds a reflexive edge, breaking the GL frame condition) and honestly re-signs
the receipt still fails verification — **rejected on evidence, not on
signature**. Evidence over proof, mechanically enforced.

`OBSTACLE HIT: true (≥1 obligation refuted → recorded, not licensed)` — the
recorded run's summary line is the thesis in one line.

## 6. Claim boundary

- The engine decides **propositional** GL. No first-order or quantified
  provability logic is implemented or claimed.
- The modal reading is a **model** of proof-based licensing, conditional on
  the derivability conditions; nothing here measures or characterizes any
  deployed learned system.
- A receipt certifies that boundary code reached a verdict with a replayable
  witness. It does not certify any agent safe, aligned, sound, or consistent —
  the content of the theorem is precisely that such certificates are not
  available at same strength.
- Receipts here are signed with a dev-only HMAC (module annotated
  `SYNTH_ONLY`; assumption `A_DEV_HMAC_KEY_CUSTODY` registered UNMET). Their
  assurance rests on the replayable countermodel, not the signature. No
  hardware attestation is implemented or claimed.

## 7. Next (Q2, pointer only)

Q1 bounds *proof*: what a same-strength system can certify about a successor.
Q2 bounds *evaluation*: what a bounded evaluator can certify about an object
more algorithmically complex than itself (Chaitin's incompleteness).
Kolmogorov complexity is uncomputable, so the honest instrument is one-sided:
computable **upper** bounds can certify simplicity, never complexity. The
planned gate admits only payloads certified *within* the evaluator's
comprehension budget and emits `EVALUATION_UNDECIDABLE` — fail-closed — for
everything else, with the one-sided error stated, measured, and recorded.
