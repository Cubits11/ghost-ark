# Ghost-Ark Experiments — Pre-Registration and Measured Results

Tier: **core**. Every number here was produced by a command in this repository and can be
regenerated. Where a number is unflattering, it is reported anyway.

**Run all eight:**

```bash
npm run experiments
```

| | Experiment | Provenance | Confidence intervals? |
|:--|:---|:---|:---|
| E1 | Provenance kernel census (31 classes x 5 arms) | census | no — exact counts |
| E1-B | Randomized kernel probe (declared generator) | **sampled** | **yes — the only place they are legitimate** |
| E2 | Verification cost | repeated measurement | no — p50 with IQR |
| E3 | Adversarial corpus detection | census | no — exact counts |
| E4 | Metamorphic guard | census | no — exact counts |
| E4-B | Compromised-signer fixtures | census | no — exact counts |
| E5 | Cross-language verifier agreement | census | no — exact counts |
| E6 | Verifier option-confusion matrix | census | no — exact counts |
| E7 | Cross-language differential fuzz | **sampled** | **yes** |

## Reporting rules (binding on all experiments)

These exist because this repository previously violated each of them.

1. **No point estimate without dispersion.** Latency is reported as p50 with IQR. A bare
   p50 is not a result.
4. **No proportion without a denominator**, and no rate without its control arm.
5. **No confidence interval over a curated census.** A CI describes sampling variability
   under repeated random draws. A hand-authored corpus has none: it is the whole
   population and its size is an authoring decision. `reportProportion` refuses to attach
   an interval when provenance is `census`, and `assertCensusReporting` throws.
   *This rule exists because a Wilson interval was once computed at n = 2 and described as
   a "robust statistical lower bound". At 2/2 successes that interval's lower bound is
   below 0.4 — consistent with a true rate of one in three.*
6. **No interval below n = 30** (`MIN_N_FOR_PROPORTION_INTERVAL`), even for genuine samples.
7. **Intent before results.** E1's consumer intents are declared in
   `tools/experiments/kernelAlphabet.ts` and pinned by a test. Editing one to match a
   measured result requires editing the test, which surfaces it in review.
8. **State the host.** A latency figure without a machine is not reproducible.
9. **Report what was not measured.** A silently-dropped arm makes a system look better
   than it is.

---

## Where the code lives

| Component | Path |
|:---|:---|
| E1–E7, E10–E13 harnesses | `tools/experiments/*.ts` |
| Pre-registered E1 alphabet | `tools/experiments/kernelAlphabet.ts` |
| E12 raw-byte scanner (must not parse; pinned by a hygiene test) | `tools/experiments/rawJsonScan.ts` |
| E12 Rekor sampler (network; pre-registers its index list) | `tools/experiments/e12RealTrafficKernel.ts` |
| E13 composition search (finite model + real hops) | `tools/experiments/e13KernelComposition.ts` |
| Pre-registered E10 scope | `tools/experiments/mutationScope.ts`, `stryker.config.json` |
| TypeScript reporting discipline | `packages/research-frontier/src/stats/descriptive.ts` |
| Rust measurement stats (MAD, tie-corrected Mann-Whitney, counter quantum) | `tools/experiments/src/stats.rs` |
| Side-channel timing-floor probe (Rust) | `tools/experiments/src/bin/side_channel_timing_floor.rs` |
| Guard tests | `tests/unit/experiments/`, `tests/unit/repo-hygiene/` |

The Rust crate `ghost-ark-experiments` was orphaned until 2026-07-29 — referenced by no CI
job, no document, and no test runner, and carrying two `clippy -D warnings` violations. It
is now gated in `artifacts-verify.yml`. Its statistics are stronger than the TypeScript
module's for two-sample comparisons; prefer it over writing a weaker equivalent.

---

## E1 — Provenance kernel census

**Hypothesis.** Real canonicalization pipelines, including Ghost-Ark's, contain kernel
members that a declared consumer distinguishes; and the kernel is determined by
`parse → canonicalize → digest` rather than by canonicalization alone.

**Design.** 31 pre-registered pathology classes, each a pair of byte-distinct raw JSON
texts with a declared consumer intent (`distinct` or `equivalent`). Five arms, one of which
(CPython) has a genuinely independent parser and one of which is the strict-admission
mitigation. Verdicts: `sound`, `unintended-kernel` (collapsed a distinction a consumer
needs), `over-discrimination` (split something every consumer unifies), `fail-closed`,
`sound-by-rejection`, `rejection-asymmetry`.

**Provenance: census.** Curated and adversarial. No confidence intervals. Exact counts only.

**Command:** `npm run experiment:e1`

### Measured result

Alphabet expanded from 12 to **31** classes on 2026-07-29, specifically to attack falsifier F2
("the finding may be an artifact of what the author chose to look at"). Breadth is the only
honest answer to that. Every added intent was declared before the arms were re-run.

| arm | indep. parser | sound | **unintended-kernel** | over-discrim. | fail-closed | sound-by-rejection | rejection-asymmetry |
|:---|:---|---:|---:|---:|---:|---:|---:|
| `ghost-ark-receipt-schema` | no | 23 | **5** | 1 | 1 | 1 | 0 |
| `ghost-ark-independent-verifier` | no | 23 | **5** | 1 | 1 | 1 | 0 |
| `ghost-ark-strict-admission` (mitigation) | no | 23 | **0** | 1 | 2 | 5 | 0 |
| `naive-sorted-stringify` (control) | no | 23 | **6** | 1 | 0 | 1 | 0 |
| `python-json-sorted` | **yes** | 21 | 4 | 3 | 1 | 2 | 0 |

**Widening the alphabet found two MORE defects, and the mitigation still holds at zero.**
The new members are `nested-duplicate-key-in-array` (a duplicate key two levels deep, inside
an array) and `duplicate-empty-key` (the degenerate `""` key repeated). Both matter: a guard
that only inspected top-level keys, or that special-cased the empty string, would pass the
original 12 classes while leaving the collapse fully exploitable. Universal unintended kernel
members (collapsed by every deciding arm) rose from 2 to 4.

The added positive controls all pass, which is what makes the mitigation credible rather than
merely strict: `safe-integer-neighbours` (two adjacent integers just *inside* the safe range,
which must stay distinct and do), `array-element-order` (arrays are ordered, and no arm sorts
them), `deep-nesting-depth` (200 vs 201, catching silent truncation), and
`large-document-single-byte` (two 64 KiB documents differing in one late byte, catching a
digest computed over a prefix).

Verdict vocabulary: `sound-by-rejection` means one side was admitted and the other refused
where a consumer needs them distinguished — no false shared identity is issued, and the
honest document still receives one. `rejection-asymmetry` is the failure mode of a strict
rule: refusing one of two documents every consumer treats as identical. The mitigation arm
scores **0** on that, which is what makes it a fix rather than a trade.

Per-class result for Ghost-Ark's own pipeline (the original 12 classes; run
`npm run experiment:e1 -- --json` for all 31):

| pathology class | intent | observed | verdict |
|:---|:---|:---|:---|
| `duplicate-key-last-wins` | distinct | collapsed | **unintended-kernel** |
| `integer-precision-loss` | distinct | collapsed | **unintended-kernel** |
| `decimal-literal-collapse` | distinct | collapsed | **unintended-kernel** |
| `non-finite-overflow` | distinct | rejected-both | fail-closed |
| `lone-surrogate-escape` | distinct | distinct | sound |
| `unicode-nfc-vs-nfd` | equivalent | distinct | **over-discrimination** |
| `object-key-order` | equivalent | collapsed | sound |
| `insignificant-whitespace` | equivalent | collapsed | sound |
| `escaped-vs-literal-char` | equivalent | collapsed | sound |
| `numeric-exponent-form` | equivalent | collapsed | sound |
| `negative-zero` | equivalent | collapsed | sound |
| `string-vs-number-type` | distinct | distinct | sound |

### Findings

**F1.1 — Ghost-Ark's own pipeline has five unintended kernel members.** `{"amount":1,"amount":2}`
and `{"amount":2}` receive the same receipt identity. So do two integers one apart above
2^53; two distinct decimal literals that round to the same double; a duplicate key nested
inside an array; and the degenerate `""` key repeated. Every one of these collapses happens
inside `JSON.parse`, before any Ghost-Ark code executes.

**F1.2 — The kernel is set by the parser, which is the corollary C1.** On
`integer-precision-loss` all three V8 arms are unsound and the CPython arm is **sound** —
same canonicalization rules, different parser, opposite verdict. Auditing the
canonicalizer alone cannot find this.

**F1.3 — Fail-closed rejection is load-bearing.** On `non-finite-overflow` Ghost-Ark
rejects both sides. The naive control arm assigns `1e400` and `1e401` the *same digest*,
because `JSON.stringify(Infinity)` is `"null"`. This is the comparative result: the ten-minute
homebrew canonicalizer a reasonable engineer would write issues a false shared identity
exactly where Ghost-Ark refuses to issue one.

**F1.4 — Cross-runtime verification is not sound today.** Four divergences, each of which
would break a receipt verified in one runtime and re-verified in another:
`integer-precision-loss`, `non-finite-overflow`, `lone-surrogate-escape` (CPython emits a
canonical form that has **no UTF-8 encoding** and therefore cannot be digested at all),
and `numeric-exponent-form` (CPython over-discriminates `1e2` from `100`).

**F1.5 — Over-discrimination is real too.** `unicode-nfc-vs-nfd` splits a name that every
consumer treats as one string. Evidence that passed through a normalizing hop fails
re-verification.

**F1.6 — The defect is now fixed, and the fix is measured by the same census that found it.**
`packages/receipt-schema/src/strictJsonAdmission.ts` adds text-level admission control that
runs **before** `JSON.parse`, which is where all three collapses occur. Three rules:

| Rule | Rejects | Boundary rationale |
|:---|:---|:---|
| `duplicate_object_key` | the same key twice at any depth | `JSON.parse` resolves duplicates last-wins, destroying the difference between a document that asserted a field twice and one that asserted it once |
| `unsafe_integer_magnitude` | integer literals above 2^53−1 | above this, distinct integers share a double |
| `excess_significant_digits` | numeric literals with >17 significant digits | 17 is a double's round-trip precision; beyond it the text asserts precision the receipt cannot carry |

Measured effect: **unintended kernel members 5 → 0**, with **zero** rejection-asymmetry. The
mitigation was built against the original 12 classes and still holds at zero after the alphabet
was widened to 31 — it generalizes rather than being fitted to the cases that motivated it.

Two design decisions that keep this a fix rather than a trade:

- It is **additive**. `canonicalize()` is untouched, so every existing receipt identity and
  signature is byte-identical. This is admission control at the trust boundary, not a change
  to canonicalization, and it needs no schema migration. A test asserts
  `canonicalize(parseStrictJson(t)) === canonicalize(JSON.parse(t))` for admissible input.
- It deliberately does **not** require exact representability (that would reject `0.1`, since
  0.1 is not a double — unusable) and does **not** require a canonical numeric form (so `1e2`,
  `100`, and `1.0e2` all stay admissible, since no declared consumer distinguishes them). It
  targets over-precision only. All three reproducibility fixtures remain admissible.

**Still not fixed:** `unicode-nfc-vs-nfd` over-discrimination. Addressing it means choosing a
normalization policy for string values, which changes what gets signed and therefore requires
a receipt schema migration. Recorded in §Open Gaps rather than quietly handled.

**F1.7 — E1's own harness had the defect E4 exists to catch, and it was found by applying E4
to E1.** The Python arm reported a missing interpreter through the same channel CPython uses
to reject an input: `rejected("python3 unavailable: ...")`. The consequences compounded
silently.

1. Every pathology became a `rejected-both` cell, so the arm scored `fail-closed` on all 31
   classes.
2. A uniformly fail-closed arm produces no `collapsed`/`distinct` cells, so it stops being a
   *deciding* arm and drops out of the unanimity test behind `universal_unintended_kernel`.
3. That headline count therefore moved **4 → 5**, with exit code 0 and one annotation line
   elsewhere in the report.

Measured with the E4 discriminator — shadow `python3` on `PATH` with a shim that exits 127,
re-run:

| | `python3` present | `python3` broken |
|:---|:---|:---|
| python arm verdicts | 21 sound / 4 unintended-kernel / 3 over-discrim | 0 sound / 31 fail-closed |
| `universal_unintended_kernel` | **4** | **5** |
| exit code | 0 | 0 |

A number that changes with ambient environment while the run still reports success is exactly
the tautology E4 was built to police, sitting inside the experiment infrastructure. Two
separate faults were behind it, and they need different fixes:

- **Absence of evidence was encoded as evidence.** `runPythonArm` now raises
  `ArmUnavailableError` instead of returning a rejection, `runE1Census` probes each declared
  arm once before committing the alphabet to it, and a missing arm is **excluded** rather than
  scored. The census then *refuses to emit* unless the caller passes
  `{ allowDegradedArms: true }`, and a degraded report carries `degraded: true` plus an
  `excluded_arms` list. Dropping an arm changes `universal_unintended_kernel` rather than
  merely widening it, so the two runs are not comparable and the report now says so.
- **A transient spawn failure aborted the run.** Under parallel load `execFileSync` exceeded
  its timeout and threw `ETIMEDOUT` straight out of the census, making the suite
  nondeterministically red — the same class as the CDK-synth flake in `AGENTS.md`. Spawns now
  retry once on transient `errno` codes only; a definitive failure still raises
  `ArmUnavailableError` rather than being laundered into a rejection.

Pinned by `tests/unit/experiments/armAvailability.test.ts`, which shells out with a broken
`python3` on `PATH` because `probePython` caches per process — mutating `PATH` inside the
worker would measure the cache rather than the behavior.

The measured `universal_unintended_kernel` count with all five arms present is unchanged at
**4**. This fault affected what happens when the environment is incomplete, not the recorded
result on a complete one.

### Coverage boundary (what E1 does NOT cover)

The alphabet is hand-curated. It contains no: deeply nested structures, very large
documents, JSON5/relaxed-syntax inputs, BOM handling, duplicate keys nested inside arrays,
`__proto__` as a literal key, integer keys, or locale-dependent number parsing. **Absence
of a class here is not evidence of its absence in practice.** E1 shows these collapses are
possible and present; it does not establish how often they occur in real traffic.

---

## E1-B — Randomized kernel probe (the only experiment with confidence intervals)

**Hypothesis.** Under a declared adversarial generator, the unguarded pipeline collapses
semantics-changing mutations at a substantial rate, and strict admission drives that rate to
zero without cost to semantics-preserving mutations.

**Why it exists.** E1's census establishes that unintended kernel members EXIST and are
PRESENT. It cannot establish how OFTEN they arise, because a curated corpus has no sampling
distribution to generalize from. That is falsifier **F2**, and adding more curated classes
does not close it. E1-B closes it the only way available: draw documents at random from a
declared generator, apply a mutation operator drawn from a declared set, and measure the
collapse rate. Because the draws are genuinely random from a stated distribution, **a Wilson
interval here describes real sampling variability and is legitimate** — the only place in this
repository where that is true.

**Design.** 8 mutation operators split by declared semantics: `preserving` (key reorder,
insignificant whitespace, escape form — a collapse is CORRECT) and `changing` (duplicate a
key, adjacent unsafe integers, adjacent decimal literals, excess precision, type swap, null
to absent — a collapse is an UNINTENDED KERNEL MEMBER). 400 trials per operator, seeded
mulberry32 PRNG, exactly reproducible from the seed. `Math.random()` is deliberately unused:
a result that cannot be replayed is not evidence.

**Command:** `npm run experiment:e1b` (add `--seed N` to replay, `--trials N` to scale)

### Measured result — seed 6221083, 400 trials/operator

Changing operators; a collapse is an unintended kernel member. Denominator is
**decided + rejected**, so both arms face the same denominator:

| operator | arm | decided | rejected | collapsed | unsound | 95% Wilson |
|:---|:---|---:|---:|---:|---:|:---|
| `duplicate-an-object-key` | unguarded | 96 | 0 | 96 | 100.0% | [96.2%, 100.0%] |
| | strict admission | 0 | 96 | 0 | **0.0%** | [0.0%, 3.8%] |
| `adjacent-unsafe-integers` | unguarded | 121 | 0 | 120 | 99.2% | [95.5%, 99.9%] |
| | strict admission | 0 | 121 | 0 | **0.0%** | [0.0%, 3.1%] |
| `adjacent-decimal-literals` | unguarded | 93 | 0 | 93 | 100.0% | [96.0%, 100.0%] |
| | strict admission | 0 | 93 | 0 | **0.0%** | [0.0%, 4.0%] |
| `add-excess-precision-digits` | unguarded | 94 | 0 | 94 | 100.0% | [96.1%, 100.0%] |
| | strict admission | 0 | 94 | 0 | **0.0%** | [0.0%, 3.9%] |
| `swap-scalar-type` | both | 133 | 2 | 0 | 0.0% | [0.0%, 2.8%] |
| `null-to-absent` | both | 65 | 41 | 0 | 0.0% | [0.0%, 3.5%] |
| `promote-integer-past-safe-range` | unguarded | 122 | 0 | 0 | 0.0% | [0.0%, 3.1%] |

Preserving operators; a collapse is correct behavior and a split would be
over-discrimination. Both arms score 100% on all three (`reorder-object-keys` 86/86,
`insert-insignificant-whitespace` 222/222, `escape-ascii-letter` 52/52).

**Aggregate over all changing operators, same denominator for both arms:**

| arm | unsound outcomes | rate | 95% Wilson |
|:---|:---|---:|:---|
| `ghost-ark-receipt-schema` | 403/767 | **52.5%** | **[49.0%, 56.1%]** |
| `ghost-ark-strict-admission` | 0/767 | **0.0%** | **[0.0%, 0.5%]** |

The intervals are **disjoint**, which is what establishes the effect rather than asserting it.

### Findings

**F1B.1 — The effect is large and interval-bounded.** Over half of semantics-changing
mutations collapse to a shared receipt identity on the unguarded pipeline under this
generator. Strict admission takes that to zero, and the two intervals do not overlap.

**F1B.2 — The comparison is denominator-fair, and that mattered.** An earlier version of
this experiment scored each arm over its own `decided` trials only. That let the guarded arm
look good by *rejecting* precisely the inputs the unguarded arm collapses and then being
graded on what remained — 505 vs 193 trials, an apples-to-oranges result. Rejection now
counts as a sound outcome and both arms are scored over all applicable trials.

**F1B.3 — Two operators measure "value changed", not "identity collapsed", and are retained
as controls.** `promote-integer-past-safe-range` substitutes one large integer for a small
one, producing two genuinely different values, so 0% collapse is the correct result. Detecting
the actual large-integer collapse required operators that construct BOTH sides
(`adjacent-unsafe-integers`, `adjacent-decimal-literals`), which is why those exist.

**F1B.4 — Determinism is tested in both directions.** One test asserts the same seed
reproduces a byte-identical report; another asserts a different seed does not. A harness that
silently ignored its seed would look perfectly deterministic.

### Coverage boundary

The interval describes sampling variability **under this generator**, which is a model of
adversarial input, not a sample of production traffic. Quoting it as a real-world frequency
would be exactly the inferential overreach the census rules exist to prevent. E1-B narrows F2
from "no idea how often" to "under a declared adversarial generator, at this rate, with this
interval". **Real-traffic frequency remains an open gap.**

---

## E4-B — Compromised-signer fixtures

**Hypothesis.** The verifier checks that E4 found unisolatable are load-bearing, and can be
shown so by an adversary who holds the signing key.

**Why it exists.** E4 found 5 of 10 checks flip zero attacks when neutered. The cause was a
threat-model gap: every existing fixture that mutates a signed field also invalidates the
digest and signature, the verifier short-circuits at `signature`, and the earlier checks were
never the thing that caught it. Isolating them requires a **valid signature over a mutated
payload**.

**Feasible without any secret.** The HMAC path uses a *published dev-only test vector*
recorded in `examples/reproducibility/manifest.json`. It is not a credential — local HMAC
signing is dev-only and is never a production signing mode. Holding it lets the generator play
the compromised signer exactly. **The RSA/KMS path is not covered**: this repository holds only
the public key, so a valid RSA-PSS signature over a mutated payload cannot be produced here.
That asymmetry is a real limit, recorded rather than worked around.

**The lever.** `receipt_id` is *inside* the signed payload but is itself derived from the
payload *without* it:

```
unsigned         = receipt − receipt_signature
canonicalPayload = canonicalize(unsigned)              <- signature and envelope digest cover THIS
receipt_id       = "grct_" + sha256(canonicalize(unsigned − receipt_id))
```

So a signer can validly sign a payload containing a *wrong* `receipt_id`. Digest and signature
pass over exactly the bytes presented; the independent recomputation fails.

**Command:** `npm run experiment:e4b` (regenerate), `npm run experiment:e4` (measure)

### The four fixtures

| id | isolates | verifier verdict | what it demonstrates |
|:---|:---|:---|:---|
| MAL-027 | `receipt_id` | FAIL (`receipt_id`) | Digest and signature valid; only the id recomputation rejects |
| MAL-028 | `tenant_expectation` | PASS, then FAIL with a consumer expectation | Every intrinsic rule passes; only the consumer set distinguishes |
| MAL-029 | — | **PASS by design** | Backdated by one year, validly signed. No freshness policy exists |
| MAL-030 | — | **PASS by design** | `decision_post` rewritten to ALLOW, validly signed |

### Measured effect on E4

| | before E4-B | after E4-B |
|:---|---:|---:|
| load-bearing checks | 5 | **7** |
| checks with no dependent fixture | 5 | **1** (`tenant`) |
| checks not fixture-isolable by construction | not distinguished | **2** |

Now load-bearing: `schema`, `receipt_id`, `digest`, `signature`, `envelope`, `key_id`,
`tenant_expectation`.

### Findings

**F4B.1 — The isolation works, and the digest check is the evidence.** MAL-027 reports
`receipt_id` FAIL. The verifier then reports `signature` as *skipped* rather than invalid,
because it short-circuits once an earlier check fails. The **passing `digest` check** is what
proves the signature was genuinely valid over these bytes.

**F4B.2 — A 10/10 isolation target is unreachable in principle, and claiming it would be
dishonest.** Two checks cannot be isolated by any receipt fixture:

- `configuration` fires on missing *verifier options* (no HMAC secret, no public key). That is
  a property of the caller, not of any receipt.
- `canonical_payload` fires only when `canonicalize()` throws — on `undefined`, bigint, `Date`,
  `Buffer`, `Map`, `Set`, non-finite numbers, sparse arrays, custom prototypes. **`JSON.parse`
  cannot produce any of those.** It is a defensive guard against host objects reaching the
  signer in-process, exercised by the `hashCanonicalization` unit tests, not by the corpus.

The honest exit condition is therefore *every check accounted for in exactly one bucket*:
7 isolated + 1 genuine gap + 2 principled limits = 10. A test asserts that sum.

**F4B.3 — One genuine gap remains.** `tenant` is emitted only by `verifyReceiptRecord`, the
record-receipt (`rct_`) path, and the corpus contains no record receipts.

**F4B.4 — Two fixtures are expected to be ACCEPTED, and that is the most important result
here.** MAL-029 and MAL-030 pass every check. A validly-signed receipt can assert a backdated
timestamp, or that a REFUSE decision was an ALLOW, and remain cryptographically flawless.
Signing proves signing authorization over a payload; **it does not make the payload true.** No
verifier rule detects this and none is claimed to.

To keep that from silently weakening the corpus, the manifest contract is now explicit: every
fixture must be REJECTED unless it declares `accept_documented_boundary`, in which case it must
be ACCEPTED *and* carry a `claim_boundary`. The default stays strict, so a fixture cannot become
non-strict by omission — only by an explicit, reviewed declaration. E3 gives these their own
`documented-boundary` stratum and excludes them from both numerator and denominator, so
"undetected: 0" keeps meaning something.

### Coverage boundary

Dev HMAC path only. No RSA/KMS compromised-signer coverage, because only the public key is
present. These fixtures show specific checks are independently load-bearing under a
key-holding adversary; they are not evidence about cryptographic strength, and a receipt that
passes every check is not thereby true.

---

## E5 — Cross-language verifier agreement

**Hypothesis.** The independent verifiers reach identical verdicts on every fixture, and the
identity-only check never rejects what a full verifier accepts.

**Why it matters.** A receipt is only verifiable evidence if a party who does not run your
code reaches the same verdict. Independence is worthless without agreement: two verifiers that
disagree mean at least one is wrong, and a consumer cannot tell which.

**Design.** All 26 corpus fixtures plus the valid HMAC fixtures, against every available
verifier. Two are **peers** (full verifiers: `verifiers/node` built-ins-only, and
`verifiers/python`) and are compared for unanimity. The third,
`packages/receipt-schema` receipt-identity recomputation, is deliberately weaker — it never
verifies a signature — so it is held to a **subsumption** property instead: identity failure
must imply verification failure. The converse is not required.

**Provenance: census.** Exact counts, no intervals.

**Command:** `npm run experiment:e5`

### Measured result

```
peer verifiers:      node-independent, python-independent
subsumed verifier:   ts-receipt-identity

peers unanimous on fixtures that must FAIL: 28/28
peers unanimous on fixtures that must PASS:   2/2

PEER DISAGREEMENTS:      0
SUBSUMPTION VIOLATIONS:  0
```

### Findings

**F5.1 — Zero disagreements across two independently-implemented verifiers in two languages**,
over both the reject arm and the accept arm.

**F5.2 — Both arms are reported, because agreement on rejects alone is worthless.** A verifier
that rejected everything would score 100% on the reject arm. The accept arm (2/2) is what makes
the reject figure meaningful.

**F5.3 — Peer selection is a real methodological decision, and getting it wrong manufactured
12 false defects.** An earlier version of this experiment held the identity-only check to peer
agreement and reported 12 "disagreements" — every one of which was the weaker check correctly
declining to detect signature tampering it never inspects. A harness that scores a deliberately
weaker component as a dissenting peer measures its own design error.

**F5.4 — An unavailable verifier is reported as unavailable, never as agreeing.** A silently
absent verifier would inflate agreement to 100% by having nothing to disagree with — the same
defect class E1's Python probe guards against.

### Coverage boundary

Agreement is **not correctness**: three implementations can share a misreading, and all three
were written by the same author from the same specification, so they are not independent in the
strong sense a third-party reimplementation would provide. The RSA fixtures are excluded from
the accept arm because the shared verifier options here are the HMAC ones, and scoring an RSA
fixture under HMAC options would measure option mismatch rather than agreement.

---

## E2 — Verification cost with a baseline

**Hypothesis.** Receipt verification cost is dominated by asymmetric signature
verification, not by canonicalization.

**Design.** Six arms, 5000 measured iterations after 500 discarded warmup iterations,
timed with `process.hrtime.bigint()`. Every result feeds an O(1) sink so the JIT cannot
eliminate the work. Baseline is `json-parse-only`: what any consumer pays merely to read
the document.

**Command:** `npm run experiment:e2`

### Measured result

Host: Apple M1, darwin/arm64, 8 CPU, Node v22.22.3. 5000 measured iterations after 500 discarded warmup iterations. Canonical payload 1552 bytes.

| operation | crypto | p50 µs | IQR µs | p95 µs | ×baseline |
|:---|:---|---:|---:|---:|---:|
| `json-parse-only` | none | 1.92 | 0.13 | 2.04 | — |
| `canonicalize-only` | none | 6.46 | 2.17 | 10.29 | 3.37× |
| `canonicalize-and-digest` | hash | 7.63 | 0.38 | 8.63 | 3.98× |
| `hmac-verify` | symmetric | 9.63 | 1.92 | 15.00 | 5.02× |
| `verifier-full-hmac` | symmetric | 23.21 | 5.29 | 31.13 | 12.11× |
| `verifier-full-rsa-pss` | asymmetric | **126.25** | 8.46 | 193.46 | **65.89×** |

`monotonicity self-audit: 4/4 declared subset orderings hold`

### Findings

**F2.1 — Hypothesis supported.** Full RSA-PSS verification is ~5.4× the full HMAC path and
~65× the parse baseline. Asymmetric verification dominates.

**F2.2 — Canonicalization is not the bottleneck**, at ~3.4× the parse baseline, an order of
magnitude below the asymmetric signature.

**F2.3 — The harness audits itself.** E2 declares subset relationships (a superset arm
cannot be cheaper than its subset) and checks them. At n=2000 an inversion appeared
intermittently between `canonicalize-only` and `canonicalize-and-digest` — two costs ~1 us
apart with IQRs of 2+ us, not resolvable at that sample size. The default was therefore
raised to n=5000, where the ordering holds consistently. The harness reports such an inversion rather than publishing
an impossible number. An earlier version of this harness *caused* that inversion by using
an O(n) sink — a defect found and fixed by this self-audit.

### Coverage boundary

Single host, single process, no concurrency, no adversarial input sizing, no AWS or KMS
network path. Dispersion describes this machine's scheduling noise, **not** variation
across machines. These are not throughput numbers and not a performance guarantee.

---

## E3 — Adversarial corpus detection against the real verifier

**Hypothesis.** The malicious corpus is rejected by
`verifiers/node/ghost_receipt_verify.mjs`, and the unmutated fixtures still pass.

> **Re-measured 2026-08-02.** The block below previously recorded `26/26`
> aggregate and `25/25` verifier-intrinsic against a 26-fixture corpus. The
> corpus has since grown and gained a `documented-boundary` stratum, and this
> section was not updated with it — a stale record of exactly the kind Phase 0
> exists to find. Re-run `npm run experiment:e3` before quoting any figure here.

**Design.** Every fixture is run through the real standalone verifier with options
sourced from the reproducibility manifest. Detection is stratified by *who* rejected:
`verifier-intrinsic`, `load`, `consumer-expectation`, `undetected`. The control arm
verifies the unmutated fixtures — without it, a verifier that failed everything would
score 100%.

**Provenance: census.** Exact counts, no interval.

**Command:** `npm run experiment:e3`

### Measured result

Measured 2026-08-02, Apple M1 / darwin arm64 / Node v22.22.3.

```
aggregate detection:        28/28 DETECTABLE mutations rejected somewhere in the pipeline
documented boundaries:      2 fixtures the corpus declares should be ACCEPTED (excluded from the rate)
verifier-intrinsic:         26/26 rejected by verifier rules alone (quote THIS for verifier claims)
control arm:                3/3 unmutated base fixtures PASS

rejection strata:
  verifier-intrinsic     25
  load                    1   (MAL-024, malformed JSON)
  consumer-expectation    2
  documented-boundary     2
  undetected              0

UNDETECTED and NOT declared acceptable: 0
```

### Findings

**F3.1 — Quote the stratified number, not the aggregate.** The aggregate folds in a
fixture no verifier rule can reject (a JSON load failure) and two rejected only by a
declared consumer expectation. The defensible claim is **26/26 verifier-intrinsic**, which
is what the harness itself labels "quote THIS for verifier claims".

**F3.1b — Documented boundaries are excluded from the rate, not scored as wins.** Two
fixtures are ones the corpus *declares should be accepted*. Counting them as successes
would inflate the number by rewarding the verifier for correct acceptance in a
*detection* metric; dropping them silently would hide two fixtures from the denominator.
They are reported as their own stratum.

**F3.2 — MAL-014 is the thesis in miniature.** A byte-identical, cryptographically valid
receipt from tenant A presented to a tenant-B consumer. No verifier rule can reject it —
the receipt is *correct*. Only the consumer's declared expectation distinguishes it. That
is precisely `Sound(C, Σ, P)` depending on `P`: the same receipt is sound for one consumer
set and unsound for another, with `C` unchanged.

**F3.3 — Rejection reasons are recorded per fixture**, so the evidence is *which check
caught it*, not merely that something did.

### Coverage boundary (what this corpus does NOT contain)

Stated explicitly because a corpus is only evidence if its limits are known. **No**
fixtures for: a **compromised signer** (an attacker able to produce valid signatures over
mutated payloads — this is why E4 finds `receipt_id` unisolatable), multi-field coordinated
mutations, chain/checkpoint-level attacks across many receipts, ledger completeness or
omission attacks, timing or side-channel attacks, key-rotation-boundary attacks, or any
live AWS/KMS custody attack. A 26/26 result says nothing about these.

---

## E4 — Metamorphic guard: are the detections load-bearing?

**Hypothesis.** E3's detections depend on actual verifier mechanisms, and are therefore
not tautological.

**Why this experiment exists.** `dab/bench/attacks/` reported near-perfect detection while
several of its checks invoked no Ghost-Ark component at all. Its nonce-swap "detection"
was computed as `requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce`
— true by construction of its own two fixtures. A green result there was a statement about
fixture construction. See §Retractions.

**Design.** For each of the 10 verifier check names, build a mutant verifier in which that
check is forced to pass, and re-run the whole corpus. A detection that *stops* when its
mechanism is broken is load-bearing; one that persists is not measuring the system. Plus an
`ALL` mutant forcing every check to pass. Same discipline as the mutant-paired TLA+ specs.

**Command:** `npm run experiment:e4`

### Measured result

| mutated check | flipped to undetected | still detected | control arm intact |
|:---|---:|---:|:---|
| `schema` | 4 | 21 | yes |
| `key_id` | 2 | 23 | yes |
| `digest` | 1 | 24 | yes |
| `signature` | 1 | 24 | yes |
| `envelope` | 1 | 24 | yes |
| `receipt_id` | 0 | 25 | yes |
| `canonical_payload` | 0 | 25 | yes |
| `configuration` | 0 | 25 | yes |
| `tenant` | 0 | 25 | yes |
| `tenant_expectation` | 0 | 25 | yes |
| **`ALL`** | **24** | **1** | yes |

```
load-bearing checks: schema (MAL-019, MAL-023, MAL-025, MAL-026),
                     key_id (MAL-004, MAL-005), digest (MAL-002),
                     signature (MAL-003), envelope (MAL-006)

TAUTOLOGY VERDICT: PASS — with every check forced to pass, all 1 remaining
detections are parse failures. No corpus detection is tautological.
```

### Findings

**F4.1 — E3 is not tautological.** Forcing every check to pass drops detection from 25 to
1, and that survivor is the malformed-JSON fixture, which no check mutation can rescue.

**F4.2 — Five checks are provably load-bearing**, each with named dependent fixtures.

**F4.3 — RESOLVED by E4-B (2026-07-29).** `receipt_id` is now load-bearing. See §E4-B. The
original finding is retained below because it is the reasoning that produced the fix.

**F4.3 (original) — `receipt_id` cannot be isolated by this corpus, and the reason is a
threat-model gap.** Every fixture that mutates `receipt_id` also breaks the digest and signature, so
neutering the `receipt_id` check alone changes nothing. Isolating it would require a
receipt whose `receipt_id` is inconsistent with its payload *while carrying a valid
signature over the mutated payload* — i.e. an attacker who controls the signing key. The
corpus does not model a compromised signer. **This is a corpus gap, not evidence the check
is unnecessary.** It is the highest-value next fixture to author.

**F4.4 — Four more checks have no dependent fixture** (`canonical_payload`,
`configuration`, `tenant`, `tenant_expectation`), for the same reason: redundant coverage
or absent adversary model.

**F4.5 — The guard is self-tested.** `tests/unit/experiments/metamorphicGuard.test.ts`
contains a known-tautological detector and a known-genuine one, and asserts the
discriminator separates them. A guard that cannot fail proves nothing. E4 also refuses to
run at all if the verifier's `check()` factory no longer matches its mutation anchor,
rather than silently reporting "everything is load-bearing".

---

## E6 — Verifier option-confusion matrix

**Hypothesis.** No option combination a consumer can supply causes an invalid receipt to be
accepted, or any receipt to be accepted on wrong or absent key material.

**Scope discipline.** Built against the option surface that **exists**: `expectedKeyId`,
`expectedTenantIdHash`, `hmacSecret`, `identityHmacSecret`, `pssMode`, `publicKeyPem`, `tenant`.
There is no `skip_expiry`, no `allow_untrusted_issuer`, and no `UNSAFE_` override in this
verifier, so there is no 2^k space of safety-bypass flags to enumerate. Inventing them would
produce a matrix that tested nothing.

**Design.** 540 cells: 10 fixtures × key material (absent / correct / wrong) × `expectedKeyId`
(absent / correct / wrong) × tenant expectation (absent / matches-receipt / mismatches-receipt) ×
`pssMode`. 50 accepted.

**Command:** `npm run experiment:e6`

### Measured result — all 8 invariants hold

| # | invariant | result |
|:--|:---|:---|
| I1 | Fail closed on **absent** key material | HELD |
| I2 | Fail closed on **wrong** key material | HELD |
| I3 | A wrong `expectedKeyId` is never accepted | HELD |
| I4 | A **mismatching** tenant expectation is never accepted | HELD |
| **I5** | **ANTITONE in the consumer set** — adding a correct expectation never turns a rejection into an acceptance | **HELD** |
| I6 | An **intrinsically** invalid receipt is never accepted under any combination | HELD |
| I7 | A **relational** fixture is accepted by a matching consumer, rejected by a mismatching one | HELD |
| I8 | PSS-mode substitution is never accepted | HELD |

### Findings

**F6.1 — I5 is the thesis, measured rather than assumed.** `Sound(C, Σ, P)` is antitone in the
consumer set: adding a consumer can only add distinctions that must be preserved. Operationally,
the accepted set must shrink monotonically as correct expectations are added. It does. Had it
ever grown, the central structural claim would not hold for this implementation.

**F6.2 — PSS-mode substitution is confined.** RSA acceptance occurs only under
`digest-as-message` (the mode the fixture was signed under) and fails all 9 `digest-as-mhash`
cells. The two treatments are not interchangeable, and a receipt verifying under both would let a
consumer be induced to accept a signature the signer never produced for that interpretation.

**F6.3 — Two invariants had to be redefined, and the first version reported two false
violations.** An earlier run used a globally-fixed "correct tenant". But MAL-028's
`tenant_id_hash` *is* tenant-repro-b's commitment, and MAL-014 is a valid tenant-repro-a receipt
— so for those fixtures the labels were inverted. Their defect is **relational**: they are correct
receipts presented to the wrong consumer. Holding a relational fixture to "never accepted" would
assert that a correct receipt must be rejected. The axis is now defined *relative to the receipt*
(`matches-receipt` / `mismatches-receipt`), and fixtures are partitioned into intrinsic,
relational, and documented-boundary.

### Coverage boundary

A declared cross-product, not an exhaustive search of consumer misconfiguration. It says nothing
about cryptographic strength, and a cell that accepts is not thereby correct.

---

## E7 — Cross-language differential fuzz

**Hypothesis.** Independently-implemented JSON pipelines agree on what is acceptable, and on
which accepted inputs are the same.

**Why it differs from E1 and E1-B.** E1 is a curated census; E1-B generates *well-formed*
documents and applies declared semantic mutations. Neither can find disagreements about what
*counts* as JSON. E7 is open-ended: roughly a third of its generated corpus is malformed on
purpose (trailing commas, leading zeros, bare `NaN`, lone surrogates, bare keys), because that is
where portability divergences actually live.

**Three genuinely separate implementations**, not three wrappers over one parser:

| arm | implementation |
|:---|:---|
| `v8` | Node `JSON.parse` + Ghost-Ark `canonicalize` |
| `cpython` | CPython `json` (arbitrary-precision integers) |
| `jq` | `jq -S -c` — a third independent parser and number formatter |

jq matters because two arms can agree by shared design; three disagreeing pairwise cannot be
dismissed that way. An unavailable arm is reported as unavailable, never as agreeing.

**Provenance: sampled** from a declared seeded generator, so intervals are legitimate.

**Command:** `npm run experiment:e7` (`--seed`, `--trials`)

### Measured result — seed 15200258, 1500 inputs

Re-measured 2026-08-02 at the current default trial count. The block previously recorded
here was a 600-input run; the default has since risen to 1500, so anyone running the
documented command got numbers that did not match the documented output.

```
unanimously accepted: 749
unanimously rejected: 484

VALIDITY   267/1500 inputs   = 17.80%  95% Wilson [15.95%, 19.82%]
STRUCTURE  901/280126 pairs  =  0.32%  95% Wilson [ 0.30%,  0.34%]
```

The two are reported over **their own denominators** and are not addable — one is per input, the
other per pair. An earlier version summed them into a single rate over `trials`, which silently
combined a per-input count with a per-pair count and was meaningless.

### The eight distinct structural divergence classes

The rate counts every rediscovery; a random generator finds the same handful of classes hundreds
of times. **901 divergent pairs is not 901 phenomena.** These are the phenomena:

| pair | outlier | behavior |
|:---|:---|:---|
| `9007199254740992` vs `9007199254740993` | **v8** | identifies both as same |
| `1` vs `1.0` | **v8** | identifies both as same |
| `-0` vs `0` | **jq** | distinguishes |
| `0.1` vs `0.1000000000000000055511151231257827` | **jq** | distinguishes |
| `[0.1000000000000000055511151231257827]` vs `[0.1]` | **jq** | distinguishes |
| `{"é":-0}` vs `{"é":0}` | **jq** | distinguishes |
| `[ 0 ]` vs `[-0]` | **jq** | distinguishes |
| `[-0]` vs `[0]` | **jq** | distinguishes |

**Do not read this as eight independent phenomena.** The count rose from four to eight when
the default trial budget rose, and the four new rows are *nesting variants* of rows already
present: signed-zero distinction observed inside an array, inside an object value, and with
whitespace, plus float-precision distinction inside an array. The underlying mechanisms
remain four — the 2^53 integer collapse, `1` vs `1.0`, signed zero, and float-literal
precision. What the larger budget bought is evidence that the signed-zero divergence is not
confined to scalars at the top level, which matters because receipts nest.

### Findings

**F7.1 — E1's headline finding is independently rediscovered by random search, and strengthened.**
E1 found the 2^53 collapse with a hand-picked pair. E7 finds it by fuzzing, and names V8 as the
outlier against **two** independent implementations rather than one.

**F7.2 — No two of these three pipelines induce the same equivalence relation.** Every pair
disagrees somewhere: v8 differs from CPython on the two integer/float-identity classes, and jq
differs from both on the six signed-zero and float-precision classes. There is no pair that
agrees about which inputs are the same. This is the sharper form of corollary C1 and it is
exactly what makes cross-runtime re-verification unsound today.

**Correction (2026-08-02).** This finding previously read "each arm is the outlier on at least
one class." That is **false** and was false when written: across all eight classes the outlier
is `jq` six times and `v8` twice. **CPython is the outlier on none** — over this corpus it is
the median implementation. The pairwise-disagreement claim above survives and is what the
corollary actually needs; the per-arm claim was a stronger statement that the data never
supported. Recorded rather than silently edited, per the retraction policy.

**F7.3 — `1` vs `1.0` is a portability hazard E1 could not see.** E1 declares
`float-vs-integer-same-value` consumer-EQUIVALENT and scores Ghost-Ark *sound* for collapsing
them. CPython and jq both **distinguish** them. So a receipt canonicalized in one runtime and
re-verified in another diverges on an input E1 classifies as benign. Being sound for a declared
consumer set does not imply being portable.

**F7.4 — Lenient parsing manufactures kernel members.** jq accepts `01`, `+1`, `.5`, `NaN`,
`Infinity`, and `1e400` — none of which are JSON — and normalizes several of them. `01` and `+1`
both digest to `sha256("1")`, so jq maps three distinct inputs to one identity. Ghost-Ark and
CPython cannot have these kernel members because they reject the input outright. Strictness at
the parse boundary is a soundness property, not a usability cost.

**F7.5 — Ghost-Ark is the permissive outlier on lone surrogates.** `"\ud800"` is accepted by the
V8 arm and rejected by both CPython and jq. That is Ghost-Ark being the odd one out on a validity
question, reported because it is unflattering.

### Coverage boundary

Synthetic inputs from a declared generator; the interval describes that generator, not production
traffic. Agreement is not correctness — three implementations can share a misreading. The arms
use *different* canonical forms by design, so E7 compares the **equivalence structure** (which
inputs are identified) rather than raw digest equality, since comparing canonical bytes across
different canonicalizers would measure nothing.

---

## E10 — Mutation score over the receipt trust kernel

**Hypothesis.** The tests that cover the receipt trust kernel would fail if the kernel were
wrong.

**Why this experiment exists.** Every other gate in this repository answers "does the code
still do what the tests say?" E10 answers the question all of them assume: *would the tests
notice if it didn't?* Until now nothing checked that. A suite of 970 passing tests is
perfectly consistent with a suite that asserts nothing load-bearing, and the repository's
entire defence — do not trust the author, run the tests — rests on the assumption that it
isn't.

E4 established the discriminator principle for benchmarks: break the mechanism, confirm
detection stops. E10 is that principle applied to the test suite itself, mechanically and at
scale. Stryker introduces one small semantic change at a time into the kernel — flips a
comparison, negates a condition, drops a call, replaces a string — and asks whether any test
notices.

| verdict | meaning |
|:---|:---|
| killed | a test failed. The suite detects that change. |
| survived | every test passed. The suite does **not** detect that change. |
| timeout | the mutant hung. Counted as killed (Stryker's convention, kept for comparability). |
| no coverage | no test in scope executes that line at all. |

**Pre-registered scope.** `tools/experiments/mutationScope.ts` declares both halves and
`tests/unit/experiments/mutationScope.test.ts` recomputes them from the real import graph
every run. Both halves are gameable and they drift in opposite directions:

- Shrinking the mutated file set **raises** the score by dropping hard-to-kill code.
- Shrinking the killer test set **lowers** it, so it cannot inflate — but it can make a later
  pass look like an improvement. Pinned for that reason too.

Ten source files are mutated: the five `AGENTS.md` names under "Be careful with", plus the
five modules those five delegate integrity decisions to (`chain`, `keyManifest`, `kmsSigner`,
`kmsVerifier`, `strictJsonAdmission`). Storage adapters, the generated zod shape, the v2
prototype, type-only modules, and ledger-anchored revocation are excluded **with reasons
recorded in the module**, because an unexplained exclusion is exactly what the
pre-registration exists to prevent. Seventy test files reach that kernel transitively; the
scope test asserts set equality in both directions.

The declared scope was written by hand first and was **wrong in both directions** — it
missed 35 covering tests and included one (`semanticAuditReceipt.test.ts`) that does not
reach the kernel. The import-graph check caught it before the first measurement. That is the
whole argument for deriving the scope rather than asserting it.

**Provenance: census.** Stryker enumerates every mutation its operators can produce over the
declared files; it does not draw randomly from a population of defects. Under reporting rule
3 that means exact counts and no confidence interval, and `reportProportion` is called with a
throwing interval provider so a later flip to `"sampled"` fails loudly rather than quietly
attaching an interval to a census.

**Denominator.** `NoCoverage` mutants are excluded from the score and reported separately.
They measure *reach*, not *strength*, and conflating them would hide the difference between
"the tests are weak here" and "no test looks here" — which need different fixes.

**Commands:**

```bash
npm run mutation            # slow: hours, not minutes
npm run mutation:summarize  # per-file scores + the full survivor list
```

Deliberately **not** in `npm run validate` and not on pull requests. Stryker copies the
working tree per worker (11 GB on the recording host) and re-runs covering tests per mutant.
A gate slow enough that the honest response to a red build is "skip the slow job" is worse
than no gate. It runs weekly and on demand via `.github/workflows/mutation.yml`, with
`break: 80` in `stryker.config.json` — a threshold set to what the repository can hold, not
an aspirational one, following the same principle as the `npm audit --audit-level=critical`
gate. (Until 2026-08-12 this sentence stated the stale value 75 while the config said 80 —
the gate's own history section below was right and this sentence had drifted; now pinned by
`mutationThresholdSync.test.ts`.)

### Measured result — all 10 declared files

Host: darwin/arm64, Apple M1 x8, 8 GB, node v22.22.3. Swept one file per Stryker
invocation via `tools/experiments/run-e10-sweep.sh`, because two attempts at the
full scope in a single run were killed before completing and lost everything.

Two denominators are given for every row, because they answer different
questions and quoting one without saying which is the error:

- **covered** = (killed + timeout) / (killed + timeout + survived) — *are the
  tests that reach this code strong?*
- **total** additionally puts `NoCoverage` mutants in the denominator — *is this
  code reached at all?*

| file | covered | killed/eval | survived | no coverage |
|:---|---:|---:|---:|---:|
| `receipts/kmsSigner.ts` | **68.2%** | 15/22 | 7 | 6 |
| `receipts/signer.ts` | 73.2% | 156/213 | 57 | 4 |
| `receipts/verifier.ts` | **73.6%** | 109/148 | 39 | 2 |
| `receipts/keyManifest.ts` | 83.6% | 148/177 | 29 | 10 |
| `receipts/canonical.ts` | 86.7% | 117/135 | 18 | 0 |
| `receipt-schema/strictJsonAdmission.ts` | 87.8% | 287/327 | 40 | 7 |
| `receipt-schema/hashCanonicalization.ts` | 88.2% | 149/169 | 20 | 8 |
| `receipts/kmsVerifier.ts` | 93.9% | 77/82 | 5 | 0 |
| `receipts/chain.ts` | 95.4% | 83/87 | 4 | 1 |
| `receipts/emission.ts` | 98.1% | 204/208 | 4 | 2 |
| **aggregate** | **85.8%** | **1345/1568** | **223** | **40** |

Stryker's total-denominator score over the whole kernel is **83.6%** (1345/1608).
**2.5% of all kernel mutants are executed by no test in the declared scope**, down
from 16.2% at first measurement.

**The threshold has been wrong once and is now set from measurement.** `break: 75`
was chosen after measuring two files and described as "what the repository can
hold"; the full sweep then measured 60.6%, so it was lowered to `58` — the defect
this repository documents elsewhere as a threshold declared rather than met,
committed here and corrected. After the remediation below the measured total is
83.6%, and the gate is `break: 80`. It has moved 75 -> 58 -> 70 -> 80, each step
after a sweep rather than before one.

#### Second remediation round — the two weakest files (2026-08-12)

The two worst covered-ratio files were re-swept, remediated, and re-swept again.
Command per file: `bash tools/experiments/run-e10-sweep.sh <file>`, then
`npm run mutation:summarize`. Host as above. The re-sweeps were run
**non-incremental** (`artifacts/mutation/stryker-incremental.json` deleted
first): the incremental cache carried one stale `Survived` verdict across a
test-file change, exposed by hand-applying that mutant — seven tests fail
against it — and re-sweeping clean.

| file | covered before | covered after | killed | survivors | no coverage |
|:---|---:|---:|---:|---:|---:|
| `receipts/kmsSigner.ts` | 68.2% | **96.4%** | 15/22 -> 27/28 | 7 -> 1 | 6 -> 0 |
| `receipts/signer.ts` | 73.2% | **98.1%** | 156/213 -> 209/213 | 57 -> 4 | 4 -> 4 |

Two gaps account for nearly all of it. In `kmsSigner.ts`, the KMS Sign
**response** was never treated as an input: no test supplied a response with
missing signature bytes, a missing or alias key attestation, or an attestation
by a *different* immutable key — so the guard that stops the signer silently
re-binding to an unconfigured key was mutable without detection
(`test_kmsSigner_attestation.test.ts`). In `signer.ts`, the surviving mutants
concentrated on the rejection **contract**: messages, field labels, and
`ValidationError.context` payloads that no test asserted, plus the two clauses
of the envelope key-set check, each of which needs the input only it rejects —
a deleted *final* key for the length clause, a *renamed* key for the
element-wise clause (`test_signer_branches.test.ts`).

Every remaining survivor carries a written disposition in its covering test
file: the `typeof` left-operand in `immutableKeyIdFromSign` (equivalent within
the SDK's `string | undefined` contract), the pre-sorted key-list `.sort()`,
the zero-byte-decode branch (unreachable behind the non-empty and base64
guards; its throw body is the remaining no-coverage block), and two Buffer
encoding literals Node normalizes identically.

**Not re-measured:** the other eight kernel files and therefore the aggregate.
The 85.8% / 223-survivor aggregate above predates this round and now
understates the suite; re-derive it with a full sweep before quoting either
number.

#### First-round measurement, before remediation

| file | covered | survivors | no coverage |
|:---|---:|---:|---:|
| `kmsVerifier.ts` | 48.1% (25/52) | 27 | 30 |
| `emission.ts` | 56.3% (94/167) | 73 | 43 |
| `chain.ts` | 81.7% (49/60) | 11 | 28 |
| aggregate | 72.3% (974/1347) | 373 | 261 |

#### Remediation of the three weakest modules, measured

`kmsVerifier.ts`, `emission.ts`, and `chain.ts` were remediated against their own
survivor lists and re-swept on the same pinned scope. Two rounds each: write
tests against the report, re-measure, then write tests against what still
survived.

| file | before | after | survivors | no coverage |
|:---|---:|---:|---:|---:|
| `kmsVerifier.ts` | 48.1% | **93.9%** | 27 → 5 | 30 → **0** |
| `emission.ts` | 56.3% | **98.1%** | 73 → 4 | 43 → **2** |
| `chain.ts` | 81.7% | **95.4%** | 11 → 4 | 28 → **1** |
| `canonical.ts` | 61.0% | **86.7%** | 30 → 18 | 58 → **0** |
| `keyManifest.ts` | 61.0% | **83.6%** | 60 → 29 | 33 → 10 |
| `signer.ts` | 61.4% | **73.2%** | 66 → 57 | 46 → **4** |

Aggregate 72.3% → **85.8%** covered; total 60.6% → **83.6%**; unreached mutants
261 → **40**.

`signer.ts` is the instructive one. Its unreached mutants fell 46 → 4, so the
envelope parser is now executed — but its survivors barely moved, 66 → 57. Reach
and strength are different properties, and the new tests bought reach. The
remaining survivors are concentrated in the base64 and hex regexes, where many
mutants are equivalent under a fixed-length alphabet. That distinction is exactly
why this experiment reports both denominators.

**Three defects in the tests were found by re-measuring rather than by
reasoning.** A `decision()` fixture omitted `actionTaken` and used a `DENY`
outcome outside the schema enum; an `options.signer ?? default` helper swallowed
the `null` a test passed deliberately, so the "rejects a non-object signer" case
never reached the validator it named; and an `IntegrityCollisionError` assertion
expected the *stored* receipt id where the code reports the *incoming* one. Each
looked correct and each was wrong.

**One survivor is genuinely unkillable, and it is a real finding.** `emission.ts`
line 134 — `throw new ChainHeadConflictError("Receipt chain head kept advancing
during receipt emission")` after the retry loop — is **unreachable**. Every path
through the loop body returns, continues, or throws, and `continue` is guarded by
`attempt < 2`, so the third attempt always rethrows from the catch and the loop
never completes normally. The observable behaviour is that the last
`ChainHeadConflictError` propagates carrying the real conflict context, which is
better than the generic message the dead line would have produced. It reads as a
safety net and is not one. Recorded rather than deleted, because removing it is a
behaviour decision for the maintainer.

The same analysis explains the surviving `attempt < 3` mutant: the inner
`attempt < 2` bound dominates it, so `<` and `<=` are indistinguishable. And in
`kmsVerifier.ts` the surviving `if (!keyId)` guard is redundant with the
`immutableKmsKeyIdsMatch` check immediately after it — both reject `undefined`,
so no input separates them. These are recorded as equivalent with the argument,
not chased.

#### The finding is not the aggregate

Two patterns are sharper than the headline.

**The two remediated files are the top two.** `strictJsonAdmission` and
`hashCanonicalization` sit at 87.8% and 88.2% because survivor-targeted tests
were written for them; the eight untouched files average 61%. That is a
statement about attention, not difficulty — and it means the aggregate will move
with effort, so it is a baseline rather than a property of the code.

**The untested code is concentrated in the rules this repository states most
emphatically.** In `kmsVerifier.ts` the unexecuted lines are the key-identity
*rejections*: missing `keyId`, `!immutableKmsKeyIdsMatch(this.keyId, keyId)`, and
the response-`KeyId` mismatch. In `emission.ts` they include the empty-HMAC-secret
guard, `IntegrityCollisionError` on a replay-lookup digest mismatch,
`ChainHeadConflictError`, and the throw when a KMS signer exposes a mutable alias
`keyId`. `AGENTS.md` names immutable KMS key ARNs in verification-critical paths
as a hard requirement; the code enforcing it is largely unexecuted.

This is narrower than "KMS needs AWS". Sibling tests do reject mutable aliases at
*signing* time, and `immutableKmsKeyIdsMatch` is pure string comparison needing
no credentials. The verifier's own branches are simply not reached.

`chain.ts` was the first case worked: 28 of 88 mutants uncovered, every one a
detection — duplicate signed-receipt hash, chain break, backwards timestamp,
missing prior receipt, empty and non-array input. The suite established that a
valid chain passes and never that a broken one fails, which is the control-arm
problem this document states for detection benchmarks, applied to the chain
verifier. `test_hash_chain_negative.test.ts` closes it; the file has not been
re-measured since.

#### Remediation is measured, not asserted

`strictJsonAdmission.ts` was remediated and re-run on the same pinned scope:

| | before | after |
|:---|---:|---:|
| covered score | 81.4% (263/323) | **87.8%** (287/327) |
| survivors | 60 | 40 |
| no coverage | 11 | 7 |

26 distinct mutant signatures newly killed. **Two of the remediation's own
predictions were wrong and the re-run found them**: two tests asserted a bare
`.toThrow()` against the colon and quoted-key checks, and both mutants survived
— deleting either check does not stop the parse failing, only makes it fail
later with a different message. An assertion that cannot distinguish *failed for
the right reason* from *failed for some reason* is not a test of that check. That
is the E4 tautology, inside tests written to close an E10 gap. Both now match on
message.

The equivalence predictions held: both `\u` hex-anchor mutants were argued
equivalent *before* the re-run and both survived it. The remaining non-string
survivors are loop-bound comparisons, recorded as **unexamined** rather than
guessed to be equivalent.

#### A scope change mid-sweep, recorded

`test_hash_chain_negative.test.ts` was added to the declared scope while the
sweep was running, so `canonical.ts` and `chain.ts` were measured against a
71-file killer pool and the remaining six against 72. The added test only reaches
`chain.ts`, `canonical.ts`, and `signer.ts`, and more killers can only raise a
score, so those three rows are lower bounds. Stated rather than smoothed over.

A second scope change, 2026-08-12: `tests/unit/experiments/kernelComposition.test.ts`
arrived with E13 and reaches the kernel through E1's `classify`, so the
pre-registration invariant required adding it. **Every score in the table above
was measured before it existed and is therefore a lower bound**; none has been
re-measured against the larger killer pool.

### Coverage boundary (what E10 does NOT establish)

Mutation operators are a **proxy** for defects, not a generator of them. A high score is not
evidence of correctness, security, cryptographic soundness, or absence of design flaws — only
that the suite detects the specific edits Stryker's operators can express. Whole defect
classes lie outside them: a wrong algorithm choice, a missing check that was never written, a
protocol-level flaw, a specification misreading shared by code and tests alike. E5 already
shows the last of these is live here — three verifiers by one author can share a misreading,
and mutation testing would not notice, because the tests encode the same misreading.

A surviving mutant is a **demonstrated** gap. A killed mutant is only the absence of that one
gap.

---

## E11 — Does the kernel result survive canonicalizers this project did not write?

**Hypothesis.** Unintended kernel members are a property of the
`parse → canonicalize → digest` problem (corollary C2), not of Ghost-Ark's
implementation of it.

**Why E1 cannot answer this.** Four of E1's five arms are Ghost-Ark code and the
fifth is a Ghost-Ark script driving CPython. E5 already records that verifiers
written by one author from one specification can share one misreading, and no
amount of internal agreement detects that. C2 is exactly the claim that arms
under this project's control cannot establish.

**Design.** The same pre-registered alphabet, the same verdict function
(imported from E1 rather than reimplemented, so E11 cannot grade on a different
curve), run against four pipelines written entirely outside this repository:

| arm | language | canonicalization |
|:---|:---|:---|
| `rust-serde-json` | Rust | `serde_json` + explicit recursive key sort + `sha2` |
| `ruby-json` | Ruby | stdlib `JSON` + recursive key sort + `Digest::SHA256` |
| `cpython-json` | CPython | `json.dumps(sort_keys=True, allow_nan=False)` |
| `jq-sorted` | jq | `jq -S -c` |

Each is the canonicalization a competent engineer reaches for in that language.
None is Ghost-Ark's, and none was written with this alphabet in view. An arm that
cannot run excludes the census rather than degrading it silently — same guard as
E1, for the same reason.

**Provenance: census.** Exact counts, no intervals.

**Command:** `npm run build:e11-arm && npm run experiment:e11`

### Measured result — 31 classes × 4 third-party arms

| arm | sound | **unintended-kernel** | over-discrim | fail-closed | sound-by-rej |
|:---|---:|---:|---:|---:|---:|
| `rust-serde-json` | 19 | **4** | 4 | 2 | 2 |
| `ruby-json` | 20 | **4** | 3 | 2 | 2 |
| `cpython-json` | 21 | **4** | 3 | 1 | 2 |
| `jq-sorted` | 21 | **4** | 5 | 0 | 1 |

**F11.1 — C2 holds for duplicate keys, across four ecosystems.** Every third-party
arm exhibits unintended kernel members, and three classes are collapsed by *all
four*: `duplicate-key-last-wins`, `nested-duplicate-key-in-array`, and
`duplicate-empty-key`. Rust, Ruby, CPython, and jq were written by four different
groups, none of whom saw this alphabet, and all four identify a document that
asserted a key twice with one that asserted it once. This is the strongest
evidence in the repository that the kernel is a property of JSON identity rather
than of Ghost-Ark.

**F11.2 — C2 does NOT extend to the 2^53 collapse, and this narrows E1.** E1
reports `integer-precision-loss` among its universal kernel members — but four of
E1's five arms parse with V8, whose only number type is a double. All four
third-party arms score **sound** on that class: `serde_json`, Ruby, CPython, and
jq 1.7 preserve integer precision. **The 2^53 collapse is a property of
double-backed number models, not of JSON.** E1's finding is real and narrower
than its arm mix suggests, and recording that is the difference between a result
and an overclaim.

**F11.3 — over-discrimination is universal too.** All four arms split
`unicode-nfc-vs-nfd`, a name every consumer treats as one string. Ghost-Ark's
NFC/NFD over-discrimination is therefore not an implementation choice it could
simply fix; it is what canonical JSON does everywhere.

**F11.4 — recursion-depth limits are a divergence class E7 could not see.** Rust
and Ruby fail closed on `deep-nesting-depth` where CPython and jq accept it. A
depth limit is an availability boundary that differs per ecosystem: a receipt
that re-verifies in one runtime can be unparseable in another for reasons
unrelated to its content.

**F11.5 — the third-party arms disagree with each other**, on six classes. E7
found no two of three pipelines induce the same equivalence relation; E11
reproduces that at wider scope, so cross-runtime non-portability is not an
artifact of including Ghost-Ark in the comparison. `leading-zero-integer` is the
sharpest: jq admits `01` and collapses it onto `1`, while Rust, Ruby, and CPython
all reject the input outright.

### Coverage boundary

Four libraries, not a sample of the ecosystem. One hand-curated alphabet. **No
arm here is defective** — each behaves exactly as its documentation says, and a
collapse means only that its canonical form identifies two documents a Ghost-Ark
consumer would distinguish. E11 is not a security review of any library, and the
per-arm counts are not a quality ranking.

---

## E12 — Real-traffic kernel incidence (Arm E)

**The gap this closes.** Every incidence figure this repository had reported came from a
hand-curated alphabet or a declared generator. Falsifier F2 says the finding may therefore be
an artifact of what the author chose to look at. Closing it needs a corpus this project did
not author.

**Corpus.** Sigstore's public Rekor transparency log. Uniform random draws over the **global**
log index with a recorded seed. Provenance: **sampled** — the only experiment in this
repository that legitimately earns a confidence interval, because the draws are uniform over a
population this project did not construct and cannot influence.

**Run:** `npm run experiment:e12` (network). Seed 20260812, 3,000 draws, frame 2,438,317,323,
2026-08-12. Replay requires the seed **and** `--frame-total`: the log grows, and a different
total turns the same seed into a different index sequence.

### Measured result — 3,000 draws, 64 eligible, 2026-08-12

```
draws requested 3000 | resolved 3000 | unresolved 0 | complete true
kinds drawn:  dsse 2030 | hashedrekord 901 | intoto 69  (65 v0.0.1, 4 v0.0.2)
eligibility:  eligible 64 | absent-by-type 2931 | absent-though-typed 5
              payload-digest-mismatch 0 | unresolved 0
```

| Class | entries carrying it | 95% CI (entry level) |
|:---|:---|:---|
| duplicate-member-name | **0 / 64** | [0.00%, 5.66%] |
| unsafe-magnitude-integer | **0 / 64** | [0.00%, 5.66%] |
| non-round-tripping-literal | **0 / 64** | [0.00%, 5.66%] |
| overflow-to-infinity | **0 / 64** | [0.00%, 5.66%] |
| underflow-to-zero | **0 / 64** | [0.00%, 5.66%] |
| lone-surrogate-escape | **0 / 64** | [0.00%, 5.66%] |
| non-nfc-string | **0 / 64** | [0.00%, 5.66%] |
| invalid-utf8 | **0 / 64** | [0.00%, 5.66%] |

Corpus descriptors, without which none of those zeros is readable: **1,056,499 payload bytes**,
**18,528 object members**, **33,982 strings**, **103 numbers**, 0 of them inexact, 0 of them
above 2^53 − 1, 0 malformed payloads. Payload sizes 341 B / 3,714 B / 84,047 B
(min / median / max).

### Findings

**F12.1 — F2 is CONFIRMED, not narrowed, and this is the result.** Not one pathology class
occurred in a single real attestation payload. Stated in the form the program pre-committed
to: **the alphabet is adversarial fiction with respect to this production traffic, and the
claim contracts to "possible, not observed."** E1 shows these collapses are constructible and
that real canonicalizers exhibit them. E12 shows they are not what production supply-chain
attestations look like. Both are true and the second bounds the first.

**F12.2 — The zeros are not equally informative, and treating them as one number would be the
error.** Each class needs the denominator of its own opportunities:

| Class | opportunities in the corpus | strength of the zero |
|:---|:---|:---|
| duplicate-member-name | 18,528 object members | **strongest.** Every member was a chance to repeat a name and none did. |
| lone-surrogate-escape, non-nfc-string, invalid-utf8 | 33,982 strings | strong. |
| non-round-tripping-literal | **103 numbers** | weak. The corpus is almost entirely strings. |
| unsafe-magnitude-integer | **0 numbers above 2^53 − 1** | **vacuous.** The class had *zero* opportunities to fire. This is not evidence about large integers; it is evidence that these payloads contain almost no numbers at all. |

**F12.3 — At the level of independent producers, no rate can be bounded at all, and the
entry-level interval must not be quoted alone.** Rekor entries are not independent draws from
"the population of attestations": a handful of toolchains emit most of them and one CI run
emits many. Collapsing the clustering gives **0 / 16 producers**, and 16 is below
`MIN_N_FOR_PROPORTION_INTERVAL = 30`, so `reportProportion` **refuses an interval** — which is
the correct output and the honest reading:

> The entry-level [0%, 5.66%] describes 64 observations that are not independent. At the level
> of units that plausibly are independent, this experiment has **n = 16 and cannot bound the
> rate at all.** Reaching n = 30 producers needs a substantially larger draw.

Largest producer 20.3% of eligible entries; 63 distinct payload digests among 64 entries, so
de-duplication moves almost nothing. Producers observed: SPDX documents, apko image
configurations and build provenance, Tekton `TaskRun`/`PipelineRun` provenance, GitHub Actions
workflow provenance, and one npm publish attestation.

**F12.4 — The zero is a measurement, not a broken instrument, and that is checked rather than
asserted.** Seven synthetic payloads, one per class, are pushed through the **same**
base64-decode-and-scan path a live entry takes on every run; **all seven were detected**. A
zero from a working detector and a zero from a broken tokenizer are the same number, and this
repository has already shipped the second kind once — E1's Python arm reported a missing
interpreter through the same channel CPython uses to reject an input, and a headline count
moved with the ambient environment at exit 0.

**F12.5 — The bytes scanned are the producer's bytes, verified per entry.** Each payload's
SHA-256 is compared against the `payloadHash` the log recorded: **64 / 64 matched, 0
mismatches.** Without this the arm's central methodological claim — that it probes raw bytes
and never a re-serialization — would be a generalization from however many entries were
spot-checked by hand.

**F12.6 — The eligible population is time-skewed by construction, and the skew is not
incidental.** Eligibility requires the log to have *stored* a payload, which only `intoto`
v0.0.1 does:

| shard | drawn | eligible | eligibility rate |
|:---|---:|---:|---:|
| 1 (earliest) | 4 | 0 | 0.00% |
| 2 | 136 | 24 | **17.65%** |
| 3 (active, 95% of the log) | 2,860 | 40 | **1.40%** |

Shard 2 supplies 4.5% of the draws and **37.5% of the eligible entries**. The modern log is
dominated by `dsse`, which stores hashes only. So the property that makes an entry measurable
is correlated with era, and the estimand is **"intoto entries with stored attestations, skewed
toward the older shard"** — not "Rekor", and not "supply-chain attestations today".

**F12.7 — Sigstore is not the subject, and on this question it is the safe design.** DSSE signs
the raw payload octets under PAE and Rekor hashes those same octets. **No canonicalization
step exists in that verification path**, so the gap studied here structurally cannot bite
there. The log is used as a corpus of real build-system JSON. Any hazard a finding would
describe belongs to a downstream consumer that parses and re-serializes such a payload.

**F12.8 — Three corrections to the program document, found by building the harness.** The
frame was mis-specified as the active shard's `treeSize` when `logIndex` is global across
three shards; the pilot read 16 `dsse` entries as 16 payloads when `dsse` stores no payload,
overstating eligibility by roughly thirtyfold (67% claimed, **2.13% measured**); and "signed
attestation payload" overstates the log, which does not store the DSSE envelope and therefore
supports no signature check from log data alone.

### Coverage boundary (what E12 does NOT establish)

One log, one day, one seed. **A zero here is not evidence that these constructs do not occur
in supply-chain attestations**, and specifically not for large integers, where the corpus
offered no opportunity at all. The eligible population is a small, era-skewed, `intoto`-only
slice of the log. `unsafe-magnitude-integer` is deliberately restricted to *syntactically*
integral literals, which can under-count and cannot over-count — an asymmetry that strengthens
a positive finding and **weakens this zero**. Rekor's attestation storage has a documented size
cap; the largest payload drawn was 84 KB, so censoring at the cap was not observed but is not
ruled out, and large payloads are exactly the ones most likely to carry deep nesting and many
keys. No consumer was named or shown to distinguish any pair. Nothing here is a security review
of Sigstore, Rekor, or any producer whose entries were drawn — **no entry, producer, or
implementation observed in this experiment is defective**, and the measurement is of the JSON
identity problem, not of anyone's competence.

---

## E13 — Is the canonicalization kernel compositional? (Arm F)

**Question.** Evidence crosses hops. A receipt is canonicalized and signed at a gateway,
transported, re-parsed by a consumer, and re-canonicalized before comparison. Each hop has
its own `parse . canonicalize` and therefore its own kernel. Can soundness of a chain be
inferred from soundness of its links?

**Why it could fail.** Soundness is not a property of a canonicalizer; it is a property of a
canonicalizer *relative to an input alphabet*. In a chain the second hop is never evaluated
on the alphabet it was tested against — it is evaluated on the **first hop's image** of that
alphabet. Composition changes the alphabet the downstream hop faces. That is this program's
layering thesis restated one level up.

Provenance: **census**. Curated alphabet plus an exhaustive finite-model enumeration. Exact
counts, no confidence intervals.

Run with `npx ts-node tools/experiments/e13KernelComposition.ts`.

### Part 1 — exhaustive enumeration over a finite model

Every hop on a four-document domain is a total function into that domain plus a rejection
symbol — 5^4 = **625 hops**, **390,625 ordered compositions**, all enumerated. Verdicts come
from E1's `classify`, imported rather than reimplemented, so nothing is graded on a different
curve.

| Question | Count |
|:---|---:|
| both hops acceptable alone, composite **not** acceptable | **1,480** |
| a hop unacceptable, composite acceptable | 102,120 |
| upstream collapse neutralized **by rejection** | 75,000 |
| upstream collapse repaired **by separation** | **0** |

**The zero is the result worth having.** It is the exhaustive check of a proposition that
also has a one-line proof: if `c1(a) = c1(b)` and neither is a rejection, then
`c2(c1(a)) = c2(c1(b))` by functionality, so the composite either collapses the pair too or
refuses it. There is no third option.

> **Repair impossibility.** Once a hop maps two documents to one canonical form without
> refusing them, no downstream hop can separate them again. It can pass the collapse along
> or it can refuse. **You cannot audit an upstream collapse away downstream; you can only
> decline to build on it.**

That is the practically useful half of Arm F, and it points the other way from the
conjecture: it says component-wise reasoning fails, *and* it says exactly which repair is
available.

### Part 2 — real implementations

Nine hops, each a step a real pipeline performs, composed pairwise over the 31-class
pre-registered alphabet: 9 x 9 x 31 = **2,511 composite cells**.

Hops: `jq -S -c`, `jq -c`, CPython `json.dumps(sort_keys=True)`, the same with
`ensure_ascii=False` in two codec configurations, Ruby stdlib `json`, Node
`JSON.stringify(JSON.parse(x))`, a `js-yaml` round trip (the hop taken whenever JSON is read
by a YAML parser, as Kubernetes manifests and in-toto layouts routinely are), and a
raw-byte duplicate-name admission gate from this repository.

**The harness carries `Buffer`, not `string`, between hops, and that choice is what made the
result below visible.** The alphabet's own inputs are pure ASCII — a lone surrogate is
written as the six characters `\ud800`, not as a surrogate — so passing *inputs* as strings
would have been safe. The **intermediates** are not. Measured: hop 1 emits the WTF-8 octets
`ED A0 80`, and a `Buffer -> string -> Buffer` round trip turns them into
`EF BF BD EF BF BD EF BF BD`. A string-based harness would have replaced the surrogate on
*both* sides of the pair, reported a clean collapse, and destroyed the one counterexample
this arm found. This is the E4 discriminator applied to Arm F's harness.

#### Measured result

| | count |
|:---|---:|
| forward counterexamples (both hops acceptable alone, composite not) | **2** |
| repairs (an unacceptable hop inside an acceptable chain) | 405 |
| ... of which by **separation** | **0** |
| non-idempotent hop applications | 0 |

**The counterexample, reproduced by hand.** Class `lone-surrogate-escape`, intent `distinct`:
`{"v":"\ud800"}` against `{"v":"�"}`.

| step | observed |
|:---|:---|
| `jq` alone on the originals | **rejects** side A: `parse error: Invalid \uXXXX\uXXXX surrogate pair escape`, exit 5 — fail-closed, correct |
| CPython with `errors='surrogatepass'` alone | A becomes `{"v":<ED A0 80>}`, B becomes `{"v":<EF BF BD>}` — **distinct**, sound |
| `jq` after CPython | both become `{"v":<EF BF BD>}` — **one identity** |

The upstream hop re-encoded the escaped surrogate as raw WTF-8 octets. `jq`'s guard is
written against the **escape syntax**; the same condition arriving as **raw bytes** is not
observable to it, so it decodes the ill-formed sequence to U+FFFD and emits the bytes it
emits for the control. **A normalization step placed in front of a fail-closed verifier
disabled that verifier's refusal.** The layering thesis, inside a pipeline.

#### What this counterexample does not support, stated in the same breath

It requires **one permissive codec configuration, and that configuration was chosen by this
harness, not by any default.** Measured on the same machine:

| hop, default configuration | result on `{"v":"\ud800"}` |
|:---|:---|
| CPython `json.dumps(..., ensure_ascii=False).encode('utf-8')` | raises — **refuses** |
| Ruby stdlib `JSON.parse` | `JSON::ParserError: incomplete surrogate pair` — **refuses** |
| Node `JSON.stringify(JSON.parse(x))` | emits `{"v":"\ud800"}` — **keeps the escape**, so a downstream `jq` still refuses |

**No pair of all-default hops on this machine exhibits the counterexample.** The mechanism is
demonstrated; its incidence in deployed pipelines is **unmeasured**. This is a
"possible, not observed" result and it is reported as one.

#### The repairs are the more actionable half

All 405 repairs are by rejection, none by separation, matching Part 1. The largest groups are
the raw-byte admission gate composed in front of each other hop — 14 of 31 classes repaired
against CPython, Ruby, and the YAML round trip; 12 against `jq`. The gate reads the bytes
*before* anything parses them, which is the layer the requirement is actually about, and that
placement is what neutralizes downstream collapses.

### Coverage boundary

Nine hops on one machine, not a sample of pipelines. **The counts are not comparable across
machines with different hop availability** — `buildHops()` includes only interpreters present
on the host, and a run with `ruby` missing searches 8 x 8 x 31 cells rather than 9 x 9 x 31,
which changes the search space rather than merely narrowing it. This is E1's F1.7 lesson, and
E13 is deliberately **not** wired into `npm run experiments`: a chain that runs in CI would
report a hop-set-dependent count as a stable one. The hop list is recorded in every report;
read it before comparing two runs. One hand-curated 31-class alphabet, so
absence of a counterexample outside those classes is not evidence of absence. Chains of
length two only; longer chains are unmeasured. **No implementation here is defective** —
every one behaves as its documentation says, `jq`'s refusal is correct behaviour, and the
counterexample is a property of a composition, not of a component. Part 1's enumeration is
exhaustive over a four-element domain; the existence results transfer because a witness is a
witness, but no universal claim about larger domains is established by it beyond the
repair-impossibility argument given above, which does not depend on the domain size.

---

## E14 — Does the verdict survive cryptography this project did not write?

**Hypothesis.** The accept/reject decisions this repository reports are properties of the
receipt rules, not of the author's reading of SHA-256, HMAC, base64url, or RSASSA-PSS.

**Why E5 cannot answer this.** E5 reports 0 disagreements across three verifiers, and its own
coverage boundary says why that is weaker than it sounds: all three were written by one author
from one specification, and the Python arm hand-implements EMSA-PSS with the same reading as
the other two. **Three implementations of one misreading agree perfectly.** No amount of
internal agreement detects that, which is exactly why open gap #10 exists.

**Design.** `verifiers/thirdparty/ghost_receipt_verify_thirdparty.py` runs the same rule
sequence with every security-relevant primitive delegated outside this repository:

| decision | delegated to |
|:---|:---|
| canonical JSON | CPython `json` (native `sort_keys`, compact separators) |
| SHA-256 | `openssl dgst -sha256` |
| HMAC-SHA-256 | `openssl dgst -sha256 -hmac` |
| RSASSA-PSS | `openssl pkeyutl -verify -pkeyopt rsa_padding_mode:pss` |
| base64 / base64url | CPython `base64` (native) |

`hashlib` and `hmac` are deliberately **not** imported: they are CPython's own and would still
be third-party to Ghost-Ark, but OpenSSL buys a second, separately maintained implementation,
and the point of the arm is to maximise that distance. `thirdPartyVerifier.test.ts` asserts
both properties against the source text, because an arm that quietly imports the thing it is
checking is not an arm.

**Provenance: census.** Every fixture is run. Exact counts, no intervals.

**Command:** `npm run experiment:e14`

### Measured result — 2026-08-12

Host: darwin/arm64, CPython 3.14.6, OpenSSL 3.6.2.

| | count |
|:---|---:|
| fixtures compared (3 reproducibility + 28 corpus) | **31** |
| decisions in agreement | **31** |
| disagreements | **0** |
| committed canonical identities reproduced by CPython's canonicalizer | **3/3** |
| PSS treatments accepted by OpenSSL per RSA fixture | **exactly 1** |

### Findings

**F14.1 — The identity layer survives an independent canonicalizer.** CPython's own
`json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"))` reproduces every
committed `receipt_id` and canonical digest byte-for-byte. Ghost-Ark's canonicalizer and
CPython's serializer were written by different people and agree on these fixtures. That is a
real independence result for the layer the whole thesis is about — and it is scoped to these
fixtures, not to JSON: E1 and E11 show precisely where such agreement breaks down.

**F14.2 — The cryptographic layer is no longer this project's word.** Every digest, HMAC, and
PSS verification in the arm is computed by OpenSSL. A shared misreading of PSS, MGF1, salt
length, or base64url can no longer hide behind three implementations that agree, because a
different set of authors now decides those questions.

**F14.3 — An external oracle confirms the PSS treatments are not interchangeable.** E6 already
asserts that an RSA receipt verifies under exactly one of `digest-as-message` /
`digest-as-mhash`, using this repository's own code. OpenSSL now says the same thing from
outside it, and identifies which treatment the committed fixture satisfies:
`kms-style-rsa` verifies under **`digest-as-message` only**. That matches what
[RECEIPT_REPRODUCIBILITY_PROTOCOL.md](./RECEIPT_REPRODUCIBILITY_PROTOCOL.md) already declares
about the committed local fixtures, and it is the first time an implementation from outside
this repository has adjudicated it. The declaration was correct.

**F14.4 — The differential found a missing rule, in the arm, on its first run.** The first
version of the arm accepted `MAL-007` (envelope `schemaVersion` mutation) and `MAL-008`
(extra envelope field), which Ghost-Ark rejects. Neither was a Ghost-Ark defect: the arm had
not implemented envelope strictness. **It is recorded here rather than quietly fixed, because
"the independent arm was missing a rule" and "the two implementations disagree" produce the
same disagreement count and mean completely different things.** The rules were added and the
count went to 0. Anyone reading only the final 31/31 would otherwise conclude the arm had
agreed from the start.

### What E14 closes, and what it does not

It closes shared-misreading risk for the **cryptographic and encoding layers**. It does **not**
close open gap #10. The rule sequencing — which checks run, over which fields, in what order —
is still this project's, and a misreading there would be reproduced faithfully by both arms,
because both arms implement it from the same reading. Only an implementation written by
somebody else, from the specification, fixes that, and none exists.

### Coverage boundary

One machine, one CPython, one OpenSSL. Thirty-one fixtures, not a sample of receipts. The arm
implements the decision-receipt rules only; the evidence-receipt path (`tools/ghost-verify.mjs`)
is not covered. Agreement is differential evidence over these fixtures, not an audit, not a
proof that the rules are complete, and not evidence about model safety, compliance, or AWS
behaviour. A disagreement would be informative; agreement is weak evidence, and is the reason
the discriminator tests exist — the arm is shown to reject a tampered signature, a wrong
expected key id, and the PSS treatment the fixture was not signed under.

---

## E15 (frame probe) — is a second real-traffic population reachable?

**Not an experiment.** It measures no incidence and states no rate. Open gap #3 recorded a
*decision* ("no defensible sampling frame for npm was established, so it was not run rather
than run badly") without recording a *measurement*, so nobody could tell whether the frame was
unreachable, expensive, or merely un-attempted. This probe answers that with evidence.

**Command:** `npm run experiment:e15-frame-probe`

### Measured result — 2026-08-12, seed 20260812

| | observed |
|:---|:---|
| population | **4,283,913** documents in the npm registry replica |
| offset access (`skip`) | **refused**, HTTP 400 |
| key-ordered access (`startkey`) | **supported**, and the response discloses `offset` — the key's rank in the total ordering |
| eligible fraction | **0 of 40** drawn packages carry a provenance attestation on their latest version |

**F15.1 — The frame is reachable, and the earlier gap text understated what was known.** Because
`startkey` responses disclose the rank of the key, exact uniform-by-rank sampling is possible
by binary search on the key space, without enumerating 4.28M packages. A defensible frame
exists. That is a strictly better position than "no defensible sampling frame was established".

**F15.2 — The binding constraint is eligibility, not the frame.** npm provenance postdates most
of the registry, so a uniform draw over packages is dominated by the pre-provenance long tail.
At the eligibility measured here, reaching E12's n = 64 would require on the order of 10⁴
package fetches against a public registry. The run is therefore **specified and costed rather
than executed**, which is the same decision as before but now made on a measurement.

**F15.3 — npm would nonetheless be the better population, and this is why.** Rekor stores only
hashes for `dsse` entries, which is what capped E12's eligibility at about 2%. npm serves the
full DSSE envelope including the base64 payload, so attestation bytes can be scanned directly.
A second population would be genuinely independent of Rekor rather than a second view of it.

### Coverage boundary

The eligibility draw uses random-key sampling, which is **not** uniform over packages — a
package following a large lexicographic gap is oversampled. It is used only for an
order-of-magnitude estimate, which is robust to that bias, and it is explicitly not the scheme
a real run would use; the intended scheme is recorded in the emitted report. One registry, one
day. Nothing here says any package, publisher, or attestation is correct, safe, or defective.

---

## Retractions

Prior claims in this repository that these experiments contradict. Listed rather than
quietly deleted.

**This table is the source of record.** Each retraction carries a stable ID. The
dissertation's §6.0 restates the same set, and
`tests/unit/repo-hygiene/retractionSync.test.ts` asserts the two ID sets are
equal — because they had already drifted apart in both directions before that
test existed: three retractions here were missing from the dissertation, and one
there was missing from here.

| ID | Retracted claim | Where | Why it was wrong |
|:---|:---|:---|:---|
| **R1** | DAB Tier-0 adversarial detection results as evidence about Ghost-Ark | `docs/dissertation/04_Empirical_Evaluation.md`, `dab/bench/attacks/` | Several checks were tautological — they asserted properties of their own fixtures and invoked no Ghost-Ark component. Superseded by E3/E4. |
| **R2** | "The Rust gateway's Mutex-backed `NonceLedger` cleanly survived a `double_execution_race`" | ch. 04 | The cited benchmark is TypeScript and consults a local `Set`. The Rust gateway is never invoked by it. |
| **R3** | "Unicode spoofing is entirely eradicated at the TCB boundary" | ch. 04 | An absolute-security claim whose evidence was a *TypeScript compile error* in a benchmark that did not run. E1 shows Unicode handling **diverges across runtimes** and that NFC/NFD over-discriminates. |
| **R4** | A Wilson interval at n = 2 as a "robust statistical lower bound" | ch. 04 | At 2/2 the lower bound is below 0.4. Now structurally impossible: see reporting rules 3 and 4. |
| **R5** | `"ci": "sha256:A"` presented inside "Raw Benchmark Output" | ch. 04 and `dab/bench/attacks/concurrency.ts` | Not a hash. A hardcoded placeholder emitted by the benchmark itself. |
| **R6** | "Mitigations implemented for Zero-Days 1, 3, 4, 5" | `ghost_ark_ring0.bpf.c` banner | The file has never been compiled or loaded. Quarantined to `UNBUILT_PROTOTYPES/` with a correction. |
| **R7** | A pinned `tla2tools.jar` sha256 presented as toolchain integrity | `scripts/run-proofs.sh`, 2026-07-15 → 2026-08-01 | The digest `58d44845…` was recorded for TLA+ `v1.8.0` on **2026-07-15**. That release was first published **2026-07-31**, sixteen days later; on the day of the pin the latest release was `v1.7.4` (2024-08-05) and the pinned URL returned 404. The digest matches neither the current `v1.8.0` asset (`e22f8ffb…`), nor `v1.7.4` (`936a2620…`), nor the untracked jar at the repository root (`cc4803dc…`). It was a value that looked like verification and performed none — and because it failed closed, **the proof stage of `make reproduce` never checked a single specification between those dates**, while `tools/proofs/run-tlc.sh` fetched the same jar with *no* integrity check at all and reported green. Both runners now check one verified digest read from a single source. |
| **R8** | Nitro Enclave PCR attestation as an implemented path | `dab/gateway/src/v200.rs` | Never compiled on Linux (bulk `DescribePCRs` API does not exist); off-Linux the mock returned the exact constant the check compares against, so attestation passed unconditionally. Quarantined to `UNBUILT_PROTOTYPES/rust/`. |
| **R9** | `prototype_pollution: detected: false` used to argue the V8 runtime is hostile | ch. 04 | Stale: the fixture never exercised a prototype-pollution path, so a `false` result argued nothing about the runtime. Recorded here because the dissertation retracted it and this list did not — the two drifted, which is why they are now pinned by `retractionSync.test.ts`. |
| **R10** | Every headline latency and detection number in the conference manuscript, sourced from `dab/bench/` | `docs/paper/main.tex` — abstract, contributions list, §Evaluation, artifact appendix | The paper headlined `global_advantage: 0` across four games and an end-to-end `p50 = 5.5 µs` drawn from the directory whose own README reads "QUARANTINED: not evidence about Ghost-Ark". This is R1's defect, still load-bearing in the manuscript: R1 was recorded against the *dissertation* and never propagated to the *paper*, which carried no retraction section at all — the same both-directions drift that R6–R9 exhibited, one document further out. Superseded by **E2** (p50 with IQR against a parse-only baseline, real verifier) and **E3/E4** (real standalone verifier, control arm, metamorphic guard). Two things were withdrawn without replacement rather than re-sourced: the throughput figure (`140,941 ops/s`), because E2 explicitly does not measure throughput, and the stage decomposition (baseline dispatch / DANF commit / gateway verify), because no superseding experiment measures it. The four-game advantage figure survives only as an explicitly-labelled model-internal calculation. Pinned by `tests/unit/repo-hygiene/paperEvidenceSource.test.ts`. |
| **R11** | The four TLA+ mutant `distinct_states` counts — `63 / 396 / 22 / 221` — wherever reported as reproducible figures | `README-AE.md` row 1, `docs/paper/main.tex`, `AGENTS.md`, `artifacts/proofs/proofs_summary.json` | **The quantity is not a property of the artifact.** A baseline spec explores its full bounded state space, so its count is a model property and reproduces exactly: ProvenanceLattice 403,949, SpeculativeCollapse 529, TransportBoundary 64, DAB_NonceLedger 1,321, DAB_ExecutionBoundary 51,106, all re-derived byte-identically under a changed toolchain on 2026-08-11. A *mutant* halts at the first counterexample, and `run-proofs.sh` invokes TLC with `-workers auto`, so which state is reached first depends on thread scheduling. Measured n=10 per mutant on one host, same commit, same jar: ProvenanceLatticeMutant **61–63**, SpeculativeCollapseMutant **193–431** (2.2x spread), TransportBoundaryMutant **22–23**, DAB_NonceLedger_Mutant **185–332**. The published values are single draws from those distributions printed as constants — a bare point estimate of a varying quantity, which this document's own first empirical rule forbids. **The gate is unaffected and remains sound:** `VIOLATION_REPRODUCED` is a yes/no verdict and every mutant violates on every run. Only the state *count* is withdrawn. Prior drift (`61/240/232` vs `63/396/221`) was recorded in R10's entry and attributed to a documentation-discipline gap; that attribution was wrong — the numbers were never stable to begin with. |

## Open gaps

Honest list of what is missing, ordered by how much it would strengthen the work.

1. ~~**No real-traffic corpus.**~~ CLOSED by E12, and the closure went **against** the
   thesis: 0 of 64 real attestation payloads carried any pathology class, so F2 is
   confirmed rather than narrowed and the claim contracts to "possible, not observed".
   What replaces it as the largest open weakness is narrower and sharper:
   **no consumer has been named and shown to distinguish any pair.** Every `distinct`
   intent in this work is a declared consumer model, never an observed one. Demonstrating
   that a real policy engine — Kyverno, OPA, `in-toto` verification, a cosign policy —
   actually distinguishes one of these pairs is the single measurement that would convert
   the work from structural to consequential.
2. **E12's eligible sample has too few independent producers to bound a rate.** 64 entries
   from 16 producers; the clustered denominator is below `MIN_N_FOR_PROPORTION_INTERVAL`
   and the interval is refused. A larger draw, or a second population, is needed before any
   rate statement is defensible.
3. **No second real-traffic population** — but the frame question is now measured rather
   than asserted. npm provenance attestations expose full DSSE payload bytes and would be
   genuinely independent of Rekor. **E15's frame probe (2026-08-12) establishes that a
   defensible frame IS reachable**: `skip` is refused, but `startkey` responses disclose the
   key's rank, so exact uniform-by-rank sampling is possible by binary search over 4,283,913
   documents. The binding constraint turned out to be eligibility, not the frame — **0 of 40
   drawn packages carry a provenance attestation on their latest version**, because npm
   provenance postdates most of the registry. Reaching E12's n = 64 would take on the order of
   10^4 fetches against a public registry. Still not run; now specified and costed.
4. ~~**No compromised-signer fixtures.**~~ CLOSED by E4-B. Remaining: no RSA/KMS
   compromised-signer coverage (public key only), and no record-receipt (`rct_`) fixtures,
   which leaves the `tenant` check unisolated.
5. **No live AWS evidence bundle.** Every AWS-path claim is synth-only or local-only.
6. ~~**E1's randomized arm is not built.**~~ CLOSED by E1-B, which samples from a declared
   seeded generator and therefore earns intervals. The gap text above survived the commit
   that closed it and contradicted this document's own E1-B heading — recorded here rather
   than silently deleted, because a stale gap list is the second thing a reviewer checks.
7. **No cross-machine reproduction of E2.** Single host only.
8. **CI does not run the Rust or TLA+ artifacts on every commit** — see
   [../artifact/CI_COVERAGE.md](../artifact/CI_COVERAGE.md) for the exact matrix.
9. **E10's mutation scope covers the receipt trust kernel only.** Ten files. The rest of the
   repository — policy evaluation, runtime, vault, retrieval, gateway, the CDK stack — has no
   measured test strength at all. A repo-wide mutation score is not reported because it has
   not been run.
10. **No third-party reimplementation** — narrowed by E14, not closed. E5 reports agreement
   across three verifiers written by the same author from the same specification; they can
   share a misreading, and the Python arm hand-implements EMSA-PSS with the same reading as
   the other two. **E14 removes this project's code from every cryptographic and encoding
   decision** — canonical JSON and base64 by CPython's own libraries, SHA-256, HMAC and
   RSASSA-PSS by the OpenSSL CLI — and reports 31/31 agreement with 3/3 canonical identities
   reproduced. A shared misreading of PSS or base64url can no longer hide. **What remains is
   the part E14 cannot reach**: the rule sequencing is still this project's, and both arms
   implement it from the same reading. Only an implementation written by somebody else, from
   the specification, fixes that, and none exists.
