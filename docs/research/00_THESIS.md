# Ghost-Ark — Thesis, Evidence Map, and Falsification Conditions

One page. Five sections. If a claim is not on this page with a command beside it, it is
not a claim this repository makes.

Tier: **core** (see [RESEARCH_INDEX.json](./RESEARCH_INDEX.json)).

---

## 1. The Question

A governance receipt is supposed to answer "what happened?" It answers a narrower
question: "what happened, up to the resolution of the canonicalizer that produced the
receipt's identity?"

Write `ker(C)` for the set of input pairs that a canonicalizer `C` maps to the same
digest. Two executions inside the same kernel class are, to every receipt consumer,
the same execution. So:

> **Which real distinctions does a receipt system destroy, who needs those
> distinctions, and does the answer stay stable over time?**

## 2. The Claim

**Receipt soundness is a ternary relation `Sound(C, Σ, P)`** over a canonicalizer `C`,
an input alphabet `Σ`, and a consumer set `P` — not a property of `C` alone. And:

- soundness is **monotone in the alphabet** — a larger `Σ` can only add kernel members;
- soundness is **antitone in the consumer set** — a larger `P` can only add distinctions
  that must be preserved.

Therefore **soundness does not persist**. A receipt system that is sound today becomes
unsound as consumers are added, *with `C` unchanged and no bug introduced*. There is no
fix internal to the canonicalizer, because the failure is not in the canonicalizer.

Two corollaries this repository demonstrates rather than asserts:

- **C1.** The kernel is a property of the whole `parse → canonicalize → digest`
  pipeline, not of the canonicalizer. Distinctions are commonly destroyed by the
  *parser*, before any audited code runs.
- **C2.** Real, currently-shipping canonicalizers — including Ghost-Ark's own — contain
  unintended kernel members that a declared consumer distinguishes.

## 3. The Evidence

Every row is a command. Run them; do not take this document's word for anything.

| Claim | Evidence | Command |
|:---|:---|:---|
| C2: Ghost-Ark's own pipeline has unintended kernel members | 3 of 12 pathology classes collapse against pre-registered consumer intent | `npm run experiment:e1` |
| C1: the kernel is set by parse∘canonicalize, not canonicalize | `integer-precision-loss` is unsound in all three V8 arms and **sound** in the CPython arm — same canonicalization rules, different parser | `npm run experiment:e1` |
| Fail-closed rejection is load-bearing, not decoration | On `non-finite-overflow` Ghost-Ark rejects; the naive control arm issues one digest for two different numbers | `npm run experiment:e1` |
| The kernel defects are **fixed**, and the fix is measured by the census that found them | Text-level admission control before `JSON.parse` takes unintended kernel members 3 → 0, with zero rejection-asymmetry and `canonicalize()` byte-unchanged | `npm run experiment:e1` |
| Verification cost, with dispersion and a baseline | p50 + IQR over 5000 iterations per arm, ratio to a `json-parse-only` baseline, host recorded | `npm run experiment:e2` |
| The adversarial corpus is rejected by the real verifier | 26/26 rejected; 25/25 by verifier rules alone; 3/3 unmutated controls PASS | `npm run experiment:e3` |
| Those rejections are **not tautological** | With every verifier check forced to pass, only the parse failure still rejects | `npm run experiment:e4` |
| Formal invariants are load-bearing | Each TLA+ spec ships with a mutant that produces a counterexample | `proofs/tla/`, `proofs/dab/artifacts/` |
| Non-claim vocabulary is enforced, not promised | 772 files scanned, 0 violations | `npm run scan:claims` |

The full pre-registration, measured numbers, and coverage boundaries:
[EXPERIMENTS.md](./EXPERIMENTS.md). The formal problem statement:
[PROVENANCE_KERNEL_PROBLEM.md](./PROVENANCE_KERNEL_PROBLEM.md).

## 4. What Would Falsify This

Stated before the fact so the thesis is refutable rather than merely defended.

| # | Falsifier | What it would take |
|:--|:---|:---|
| F1 | **The ternary framing is unnecessary.** Exhibit a canonicalizer sound for *every* consumer set over a realistic alphabet, with no fail-closed rejections. | The soundness-does-not-persist result collapses to a solved engineering problem. |
| F2 | **Unintended kernel members are an artifact of the curated alphabet.** Show that E1's pathology classes cannot arise in real receipt traffic. | C2 loses practical force; the kernel becomes a theoretical curiosity. |
| F3 | **The consumer set is stable in practice.** Show that deployed receipt consumers do not grow, so antitonicity never bites. | Non-persistence becomes irrelevant even if formally true. |
| F4 | **A parser-independent kernel.** Show the pipeline kernel is fixed by canonicalization alone. | C1 is false, and auditing canonicalizers alone would suffice. |
| F5 | **The corpus results are tautological.** Show E3's detections survive when the mechanisms they depend on are broken. | E4 exists precisely to test this, and currently reports PASS. A failure here would void E3. |

F2 is the live weakness and this document will not pretend otherwise: E1's alphabet is
hand-curated and adversarial. It shows these collapses are *possible* and *present*, not
that they are *frequent*. Establishing frequency needs a corpus of real receipt traffic,
which this repository does not have. That gap is recorded in EXPERIMENTS.md §Open Gaps,
not papered over.

## 5. What Is Explicitly Not Claimed

Ghost-Ark evaluates the identifiability structure of evidence. It never evaluates what
the evidence means.

- Not a proof that any model, output, dataset, or organization is safe, aligned, or correct.
- Not compliance, certification, or conformity with any standard.
- Not production-hardened, and not post-quantum secure.
- Not evidence of live AWS behavior without a preserved live evidence bundle — none is
  present in this repository today.
- Not hardware attestation, enclave integrity, or runtime-integrity proof. The eBPF
  prototype is **not compiled and not loaded**; see
  [dab/gateway/UNBUILT_PROTOTYPES/README.md](../../dab/gateway/UNBUILT_PROTOTYPES/README.md).
- A passing test proves local artifacts behave as specified under the implemented
  verifier rules. Nothing more.

Signing proves signing authorization over a payload. It does not make the payload true.

---

## Reviewer shortcut

If you have five minutes and want to attack this rather than read it, start with
[docs/artifact/REVIEWER_ATTACK_SHEET.md](../artifact/REVIEWER_ATTACK_SHEET.md) — the ten
sharpest questions against this work, each answered with a command and its real output,
including the ones that are unflattering.
