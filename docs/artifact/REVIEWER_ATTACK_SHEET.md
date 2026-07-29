# Reviewer Attack Sheet

Tier: **core**. Written 2026-07-29 to be used *against* this repository.

These are the sharpest questions a hostile reviewer can ask, each answered with a command
and its real output. Several answers are unflattering. They are here because a reviewer who
finds a weakness the authors already documented reads it as calibration; a reviewer who
finds one the authors hid discounts everything else.

The repository's own doctrine is *do not trust the author, inspect the artifact*. That
applies to this document too.

---

### Q1. "Your benchmarks measure nothing. Show me they aren't tautological."

**This was true and is the most serious defect ever found in this repository.** Several
`dab/bench/attacks/` suites reported detection without invoking any Ghost-Ark component.
The nonce-swap "detection" was:

```ts
detected: requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce
```

True by construction of its own two fixtures. `replayAttack` consulted a local `Set`, not
the Rust nonce ledger — while the dissertation cited it as evidence about "the Rust
gateway's Mutex-backed `NonceLedger`".

**What was done:** `dab/bench` is quarantined (`dab/bench/README.md`, held in place by a
test). The claims are retracted in writing in `docs/research/EXPERIMENTS.md` §Retractions
and `docs/dissertation/04_Empirical_Evaluation.md` §6.0. Detection is now measured against
the real verifier (E3) and every detection is checked for load-bearingness (E4).

```bash
npm run experiment:e4
```

> `TAUTOLOGY VERDICT: PASS` — with all 10 verifier checks forced to pass, detection drops
> from 25 to 1, and that survivor is the malformed-JSON fixture.

**The guard is itself tested against a known-tautological detector**
(`tests/unit/experiments/metamorphicGuard.test.ts`), because a guard that cannot fail is
not evidence.

---

### Q2. "Where is your baseline? A number without a comparison is not a result."

```bash
npm run experiment:e2
```

Every arm is reported as a ratio to a `json-parse-only` baseline, with p50 **and** IQR, on a
recorded host. Full RSA-PSS verification is 65.89× the parse baseline and 5.4× the full HMAC
path.

E1 also carries a comparative arm: on `non-finite-overflow` Ghost-Ark fails closed while the
naive control canonicalizer issues **one digest for two different numbers**. That is a
comparison against the alternative a competent engineer would actually write.

---

### Q3. "What is your n, and why should I believe your statistics?"

E2: n = 5000 per arm after 500 discarded warmup iterations, p50 with IQR.

For proportions the honest answer is that **most of this repository's corpora do not warrant
inferential statistics at all**, and the code now enforces that:

- The 26-fixture corpus and the 31-class alphabet are **censuses** — hand-curated, the whole
  population, size chosen by an author. `reportProportion` refuses to attach a confidence
  interval when provenance is `census`, and `assertCensusReporting` throws.
- Intervals are additionally refused below n = 30.
- **One** experiment earns intervals: E1-B, which draws at random from a declared generator.
  See Q9a.

This repository previously computed a Wilson interval at **n = 2** and called it a "robust
statistical lower bound." At 2/2 successes that interval's lower bound is below 0.4 —
consistent with a true rate of one in three. Both the claim and the possibility of repeating
it are gone:

```bash
npx vitest run tests/unit/experiments/descriptiveStats.test.ts
```

---

### Q4. "Which of your 39 research documents is load-bearing? I'm not reading all of them."

Six. `docs/research/RESEARCH_INDEX.json` classifies every document as `core`,
`supporting`, `exploratory`, `process`, or `non-research`, and a test fails if any document
is unclassified or if the `core` tier exceeds 8 entries.

Read `00_THESIS.md`, then `PROVENANCE_KERNEL_PROBLEM.md`, then `EXPERIMENTS.md`.

Go-to-market strategy and cyber-insurance underwriting are classified `non-research` and
carry no research weight. Documents whose own titles say "DRAFT" are classified
`exploratory` and are **not evidence for any claim**.

---

### Q5. "`npm test` failed when I cloned this."

It did, and the cause was mine, not yours: `vitest.config.ts` set a global 15s
`testTimeout`, while two CDK-synth tests took ~20s under parallel load on a busy machine.
So `npm test` was **nondeterministically red on a clean clone**, and CI was
load-dependent red.

Fixed at the root rather than by inflating the timeout: the CDK template is now memoized
per option-set and pre-warmed in a `beforeAll` with a hook timeout, so the cold
`aws-cdk-lib`/jsii load is paid once instead of once per test.

```bash
npm test
```

---

### Q6. "Your `.git` is 144 MB. What did you commit?"

Compiled Rust debug binaries, including a 53.9 MB `dab-gateway` and a 43.9 MB test binary.
They are `.gitignore`d now, and a test asserts no build output is tracked:

```bash
npx vitest run tests/unit/repo-hygiene/unbuiltPrototypes.test.ts
```

**The objects remain in history.** Purging them requires a history rewrite and a force-push,
which is irreversible for anyone who has already cloned. That is a deliberate deferral, not
an oversight — it is cosmetic relative to the substantive gaps in Q9, and the decision to
rewrite public history belongs to the maintainer, not to a cleanup pass.

---

### Q7. "You claim eBPF kernel-level enforcement."

No. That file was never compiled and never loaded, and its own banner said "Mitigations
implemented for Zero-Days 1, 3, 4, 5," which was false. It is now at
`dab/gateway/UNBUILT_PROTOTYPES/bpf/` with a README that corrects its banner explicitly, and
three tests assert it is referenced by no Rust source, no `Cargo.toml`, and no CI workflow.

The development host is macOS, which has no eBPF. What the gateway actually enforces at
runtime is the userspace transit ledger and nonce tombstone path.

---

### Q8. "Your formal methods are decorative. An invariant can hold vacuously."

Correct in general, and this repository has hit exactly that hazard — `proofs/tla/README.md`
records a case where unquoted `.cfg` constants made CASE comparisons fall through so both
models passed vacuously.

Every specification is therefore paired with a deliberately-broken mutant, and CI asserts
**both directions**: baselines must pass, mutants must violate. A mutant that passes fails
CI.

```bash
curl -fsSL -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
bash tools/proofs/run-tlc.sh
```

> 4 baselines clean, 4 mutants violated, 0 failures.

`TenantIsolation.tla` and `proofs/cloud/*.tla` are **unchecked stubs** with no mutants. They
are excluded from the runner rather than passed vacuously, and listed as gaps in
`CI_COVERAGE.md`.

---

### Q9a. "Your alphabet is curated. How do I know you didn't just pick inputs that break?"

You don't, from the census alone — that is falsifier F2 and it is the best argument against
this work. Two responses, neither of which fully closes it:

**Breadth.** The alphabet went from 12 to 31 classes, and widening it found **two more**
defects (`nested-duplicate-key-in-array`, `duplicate-empty-key`) rather than diluting the
finding. It also added positive controls that must NOT collapse — adjacent integers just
inside the safe range, array element order, nesting depth 200 vs 201, two 64 KiB documents
differing in one late byte — and all of them pass. A guard that simply rejected aggressively
would fail those.

**A genuinely sampled arm.** E1-B draws documents at random from a declared generator and
applies mutation operators drawn from a declared set, so its confidence intervals are
legitimate — the only place in this repository where that is true:

```bash
npm run experiment:e1b
```

> unguarded 403/767 = **52.5%**, 95% Wilson **[49.0%, 56.1%]**
> strict admission 0/767 = **0.0%**, 95% Wilson **[0.0%, 0.5%]**
> disjoint intervals, same denominator for both arms

The denominator fairness is not incidental. An earlier version scored each arm over its own
`decided` trials, which let the guarded arm look good by rejecting exactly the inputs the other
collapses and then being graded on the remainder — 505 versus 193 trials. Rejection now counts
as a sound outcome and both arms face all 767 applicable trials.

**What this still does not establish:** the generator is a model of adversarial input, not a
sample of production traffic. Quoting 52.5% as a real-world frequency would be exactly the
overreach the census rules prohibit. Real-traffic frequency is open.

---

### Q9b. "Three verifiers that all agree could all be wrong."

Correct, and E5 says so in its own non-claim. Agreement is not correctness: three
implementations can share a misreading, and **all three were written by the same author from
the same specification**, so they are not independent in the strong sense a third-party
reimplementation would give. That is recorded as a gap in `CI_COVERAGE.md`.

What E5 does establish, over the full corpus rather than selected fixtures:

```bash
npm run experiment:e5
```

> 25/25 rejects and 2/2 accepts unanimous across Node and Python; 0 peer disagreements;
> 0 subsumption violations

Both arms are reported because agreement on rejects alone is worthless — a verifier that
rejected everything would score 100%. And peer selection turned out to be a real methodological
decision: an earlier version held the identity-only check to peer agreement and reported 12
"disagreements", every one of which was the weaker check correctly declining to detect
signature tampering it never inspects. It is now held to subsumption instead — identity failure
must imply verification failure, but not the converse.

---

### Q9c. "Your verifier takes seven options. Can a consumer misconfigure it into accepting garbage?"

Not over the 540 combinations enumerated. E6 crosses every fixture against key material
(absent / correct / wrong), `expectedKeyId`, tenant expectation, and `pssMode`:

```bash
npm run experiment:e6
```

> 8/8 invariants hold. Nothing is accepted on absent or wrong key material. An intrinsically
> invalid receipt is accepted under no combination. RSA acceptance is confined to a single PSS
> mode, so mode substitution never verifies.

The invariant worth reading is **I5: antitonicity.** Adding a *correct* consumer expectation never
turns a rejection into an acceptance — the accepted set shrinks monotonically. That is
`Sound(C, Σ, P)` being antitone in `P`, which is the thesis's central structural claim, measured on
the implementation rather than assumed from the formalism.

Two caveats. This is a declared cross-product, not an exhaustive search of misconfiguration. And
the first version of this experiment reported two invariant violations that were **my labelling
error**, not verifier defects: it used a globally-fixed "correct tenant", but MAL-028's tenant
*is* tenant-repro-b and MAL-014 is a valid tenant-repro-a receipt. Their defect is *relational* —
correct receipts presented to the wrong consumer — and holding them to "never accepted" asserts
that a correct receipt must be rejected. The axis is now relative to the receipt.

---

### Q9d. "Can I verify a Ghost-Ark receipt in a runtime you didn't write it in?"

**Not reliably, and E7 quantifies why.** This is the most consequential negative result in the
repository.

```bash
npm run experiment:e7
```

Fuzzing the same byte streams through three independent pipelines — Node's `JSON.parse`, CPython's
`json`, and `jq` — finds four distinct structural divergence classes:

| pair | outlier |
|:---|:---|
| `9007199254740992` vs `9007199254740993` | **v8** identifies both as same |
| `1` vs `1.0` | **v8** identifies both as same |
| `-0` vs `0` | **jq** distinguishes |
| `0.1` vs `0.1000000000000000055511151231257827` | **jq** distinguishes |

**No two of the three induce the same equivalence relation.** Each arm is the outlier on at least
one class, so this is not "one implementation is broken" — it is that the JSON number model does
not pin down identity. `1` versus `1.0` is the one that should worry a reviewer: E1 classifies it
as consumer-*equivalent* and scores Ghost-Ark *sound* for collapsing it, while CPython and jq both
distinguish it. **Being sound for a declared consumer set does not imply being portable.**

E7 also finds Ghost-Ark being the permissive outlier on a validity question: `"\ud800"`, a lone
surrogate, is accepted by the V8 arm and rejected by both others. That is reported because it is
unflattering.

And it shows why strictness is a soundness property rather than a usability cost: jq accepts `01`,
`+1`, `NaN`, `Infinity`, and `1e400`, and normalizes `01` and `+1` both to `sha256("1")` — three
distinct inputs, one identity. Ghost-Ark and CPython cannot have those kernel members because they
reject the input outright.

Mitigating cross-runtime divergence is a **design decision, not a patch**: mandate one runtime,
adopt a stricter admission profile than `strictJsonAdmission` currently enforces (it does not
reject `1.0`), or move off JSON. That is recorded in `CI_COVERAGE.md`, not resolved.

---

### Q9. "What is the strongest argument against your thesis?"

**Falsifier F2: the pathology alphabet is hand-curated and adversarial.** E1 proves
unintended kernel members *exist* and are *present in Ghost-Ark's own pipeline*. It does not
establish that they occur in real receipt traffic at any meaningful rate. If someone shows
these inputs cannot arise in practice, corollary C2 loses its force and the contribution
shrinks to a theoretical observation.

Establishing frequency requires a corpus of real receipt traffic, which this repository does
not have. That is recorded as the top item in `EXPERIMENTS.md` §Open Gaps and as F2 in
`00_THESIS.md`. All five falsification conditions are stated *before* the evidence, so the
thesis is refutable rather than merely defended.

Second-strongest: **no live AWS evidence exists at all.** Every AWS claim is local-only or
synth-only.

---

### Q10. "You found three vulnerabilities in your own canonicalizer and just… wrote them down?"

Initially, yes. That was the right criticism and it is now addressed.
`packages/receipt-schema/src/strictJsonAdmission.ts` adds text-level admission control that
runs **before** `JSON.parse` — which is where all three collapses actually occur, so no fix
inside the canonicalizer could have worked. Measured by the same census that found the
defects: **unintended kernel members 5 → 0, with zero rejection-asymmetry.** The fix was built
against 12 classes and still holds at zero after the alphabet was widened to 31, so it
generalizes rather than being fitted to the cases that motivated it.

```bash
npm run experiment:e1
npx vitest run tests/unit/enforcement-runtime/receipts/test_strict_json_admission.test.ts
```

Each rule test is paired with a demonstration that the collapse it prevents is *real* — the
two documents are shown to produce identical canonical forms under plain `JSON.parse`, then
shown to be refused under admission control. Otherwise they would be tests that a validator
validates.

The fix is **additive**: `canonicalize()` is untouched, so every existing receipt identity
and signature is byte-identical and no schema migration is needed. A test asserts that
directly.

What is still *not* fixed: NFC/NFD over-discrimination. Fixing it requires a normalization
policy for string values, which changes what gets signed and does need a migration. It is in
§Open Gaps, not quietly handled.

---

### Q11. "Your corpus scores 26/26. That smells like a test written to pass."

It partly is, and E4 says so. Quote **25/25 verifier-intrinsic**, not 26/26 — the aggregate
folds in MAL-014, which no verifier rule can reject.

E4 originally showed **5 of 10 verifier checks had no dependent fixture**, because every
fixture that mutated `receipt_id` also broke the digest and signature, so the verifier
short-circuited and neutering the earlier checks changed nothing. That gap is now closed by
E4-B, which models a **compromised signer**: fixtures carrying a genuinely valid signature over
a mutated payload, produced with the published dev-only HMAC test vector.

```bash
npm run experiment:e4
```

> load-bearing checks: 5 → **7** (`receipt_id` and `tenant_expectation` now isolated)

**What remains, stated precisely rather than as a round number.** A 10/10 isolation target is
unreachable *in principle*, and claiming it would be dishonest. Two checks cannot be reached by
any receipt fixture: `configuration` inspects the verifier's own options, and
`canonical_payload` rejects non-JSON host values (`undefined`, bigint, `Date`, `Map`, non-finite
numbers) that `JSON.parse` cannot produce — it guards against host objects reaching the signer
in-process. One genuine gap survives: `tenant` belongs to the record-receipt (`rct_`) path and
the corpus has no record receipts.

So: **7 isolated + 1 genuine gap + 2 principled limits = 10**, and a test asserts that sum.

**The two fixtures that PASS are the most important ones.** MAL-029 (backdated one year) and
MAL-030 (`decision_post` rewritten to ALLOW) satisfy every check. A validly-signed receipt can
assert that a REFUSE was an ALLOW and remain cryptographically flawless. Signing proves signing
authorization over a payload; it does not make the payload true. The corpus contract is now
explicit — reject everything unless a fixture declares `accept_documented_boundary`, in which
case it must be accepted *and* carry a claim boundary — so the category cannot be used to
quietly downgrade a real failure.

Still uncovered: the RSA/KMS path, because this repository holds only the public key and cannot
produce a valid RSA signature over a mutated payload.

The control arm is what keeps the number meaningful at all: 3/3 unmutated fixtures must
PASS, so a verifier that rejected everything would fail, not score 100%.

---

## The one-command version

```bash
npm ci && npm run validate && npm run test:experiments && npm run experiments
```

## What no output in this repository establishes

Model safety. Semantic truth. Alignment. Compliance or certification. Production readiness.
Live AWS behavior. Hardware attestation. Cryptographic strength of SHA-256 or RSA-PSS.
Resistance to attacks outside the stated corpora.

A passing gate means local artifacts behave as specified under the implemented verifier
rules. That is the entire claim.
