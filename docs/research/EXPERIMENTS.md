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
2. **No proportion without a denominator**, and no rate without its control arm.
3. **No confidence interval over a curated census.** A CI describes sampling variability
   under repeated random draws. A hand-authored corpus has none: it is the whole
   population and its size is an authoring decision. `reportProportion` refuses to attach
   an interval when provenance is `census`, and `assertCensusReporting` throws.
   *This rule exists because a Wilson interval was once computed at n = 2 and described as
   a "robust statistical lower bound". At 2/2 successes that interval's lower bound is
   below 0.4 — consistent with a true rate of one in three.*
4. **No interval below n = 30** (`MIN_N_FOR_PROPORTION_INTERVAL`), even for genuine samples.
5. **Intent before results.** E1's consumer intents are declared in
   `tools/experiments/kernelAlphabet.ts` and pinned by a test. Editing one to match a
   measured result requires editing the test, which surfaces it in review.
6. **State the host.** A latency figure without a machine is not reproducible.
7. **Report what was not measured.** A silently-dropped arm makes a system look better
   than it is.

---

## Where the code lives

| Component | Path |
|:---|:---|
| E1–E5 harnesses | `tools/experiments/*.ts` |
| Pre-registered E1 alphabet | `tools/experiments/kernelAlphabet.ts` |
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

peers unanimous on fixtures that must FAIL: 25/25
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

**Hypothesis.** The 26-fixture malicious corpus is rejected by
`verifiers/node/ghost_receipt_verify.mjs`, and the unmutated fixtures still pass.

**Design.** Every fixture is run through the real standalone verifier with options
sourced from the reproducibility manifest. Detection is stratified by *who* rejected:
`verifier-intrinsic`, `load`, `consumer-expectation`, `undetected`. The control arm
verifies the unmutated fixtures — without it, a verifier that failed everything would
score 100%.

**Provenance: census.** Exact counts, no interval.

**Command:** `npm run experiment:e3`

### Measured result

```
aggregate detection:        26/26 mutations rejected somewhere in the pipeline
verifier-intrinsic:         25/25 rejected by verifier rules alone
control arm:                3/3 unmutated base fixtures PASS

rejection strata:
  verifier-intrinsic     24
  load                    1   (MAL-024, malformed JSON)
  consumer-expectation    1   (MAL-014)
  undetected              0
```

### Findings

**F3.1 — Quote the stratified number, not the aggregate.** "26/26" folds in a fixture no
verifier rule can reject. The defensible claim is **25/25 verifier-intrinsic**.

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
live AWS/KMS custody attack. A 25/25 result says nothing about these.

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

### Measured result — seed 15200258, 600 inputs

```
unanimously accepted: 331
unanimously rejected: 167

VALIDITY   102/600 inputs  = 17.00%  95% Wilson [14.21%, 20.21%]
STRUCTURE  199/47278 pairs =  0.42%  95% Wilson [ 0.37%,  0.48%]
```

The two are reported over **their own denominators** and are not addable — one is per input, the
other per pair. An earlier version summed them into a single rate over `trials`, which silently
combined a per-input count with a per-pair count and was meaningless.

### The four distinct structural divergence classes

The rate counts every rediscovery; a random generator finds the same handful of classes hundreds
of times. **199 divergent pairs is not 199 phenomena.** These are the phenomena:

| pair | outlier | behavior |
|:---|:---|:---|
| `9007199254740992` vs `9007199254740993` | **v8** | identifies both as same |
| `1` vs `1.0` | **v8** | identifies both as same |
| `-0` vs `0` | **jq** | distinguishes |
| `0.1` vs `0.1000000000000000055511151231257827` | **jq** | distinguishes |

### Findings

**F7.1 — E1's headline finding is independently rediscovered by random search, and strengthened.**
E1 found the 2^53 collapse with a hand-picked pair. E7 finds it by fuzzing, and names V8 as the
outlier against **two** independent implementations rather than one.

**F7.2 — No two of these three pipelines induce the same equivalence relation.** Each arm is the
outlier on at least one class. If one arm were the outlier on all of them the story would be
"that arm is broken"; instead there is no pair that agrees about which inputs are the same. This
is the sharper form of corollary C1 and it is exactly what makes cross-runtime re-verification
unsound today.

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

## Retractions

Prior claims in this repository that these experiments contradict. Listed rather than
quietly deleted.

| Retracted claim | Where | Why it was wrong |
|:---|:---|:---|
| DAB Tier-0 adversarial detection results as evidence about Ghost-Ark | `docs/dissertation/04_Empirical_Evaluation.md`, `dab/bench/attacks/` | Several checks were tautological — they asserted properties of their own fixtures and invoked no Ghost-Ark component. Superseded by E3/E4. |
| "The Rust gateway's Mutex-backed `NonceLedger` cleanly survived a `double_execution_race`" | ch. 04 | The cited benchmark is TypeScript and consults a local `Set`. The Rust gateway is never invoked by it. |
| "Unicode spoofing is entirely eradicated at the TCB boundary" | ch. 04 | An absolute-security claim whose evidence was a *TypeScript compile error* in a benchmark that did not run. E1 shows Unicode handling **diverges across runtimes** and that NFC/NFD over-discriminates. |
| A Wilson interval at n = 2 as a "robust statistical lower bound" | ch. 04 | At 2/2 the lower bound is below 0.4. Now structurally impossible: see reporting rules 3 and 4. |
| `"ci": "sha256:A"` presented inside "Raw Benchmark Output" | ch. 04 and `dab/bench/attacks/concurrency.ts` | Not a hash. A hardcoded placeholder emitted by the benchmark itself. |
| "Mitigations implemented for Zero-Days 1, 3, 4, 5" | `ghost_ark_ring0.bpf.c` banner | The file has never been compiled or loaded. Quarantined to `UNBUILT_PROTOTYPES/` with a correction. |

## Open gaps

Honest list of what is missing, ordered by how much it would strengthen the work.

1. **No real-traffic corpus.** E1 establishes that unintended kernel members exist, not
   how often. This is falsifier F2 and the largest open weakness.
2. ~~**No compromised-signer fixtures.**~~ CLOSED by E4-B. Remaining: no RSA/KMS
   compromised-signer coverage (public key only), and no record-receipt (`rct_`) fixtures,
   which leaves the `tenant` check unisolated.
3. **No live AWS evidence bundle.** Every AWS-path claim is synth-only or local-only.
4. **E1's randomized arm is not built.** Only the census arm exists, so no experiment here
   currently earns a confidence interval. Building it is the only way to get one honestly.
5. **No cross-machine reproduction of E2.** Single host only.
6. **CI does not run the Rust or TLA+ artifacts on every commit** — see
   [../artifact/CI_COVERAGE.md](../artifact/CI_COVERAGE.md) for the exact matrix.
