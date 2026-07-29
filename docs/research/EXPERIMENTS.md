# Ghost-Ark Experiments — Pre-Registration and Measured Results

Tier: **core**. Every number here was produced by a command in this repository and can be
regenerated. Where a number is unflattering, it is reported anyway.

**Run all four:**

```bash
npm run experiments
```

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
| E1–E4 harnesses | `tools/experiments/*.ts` |
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

**Design.** 12 pre-registered pathology classes, each a pair of byte-distinct raw JSON
texts with a declared consumer intent (`distinct` or `equivalent`). Four independent
arms. Verdicts: `sound`, `unintended-kernel` (collapsed a distinction a consumer needs),
`over-discrimination` (split something every consumer unifies), `fail-closed`,
`split-decision`.

**Provenance: census.** Curated and adversarial. No confidence intervals. Exact counts only.

**Command:** `npm run experiment:e1`

### Measured result

| arm | indep. parser | sound | **unintended-kernel** | over-discrim. | fail-closed | sound-by-rejection | rejection-asymmetry |
|:---|:---|---:|---:|---:|---:|---:|---:|
| `ghost-ark-receipt-schema` | no | 7 | **3** | 1 | 1 | 0 | 0 |
| `ghost-ark-independent-verifier` | no | 7 | **3** | 1 | 1 | 0 | 0 |
| `ghost-ark-strict-admission` (mitigation) | no | 7 | **0** | 1 | 2 | 2 | 0 |
| `naive-sorted-stringify` (control) | no | 7 | **4** | 1 | 0 | 0 | 0 |
| `python-json-sorted` | **yes** | 6 | 2 | 2 | 1 | 1 | 0 |

Verdict vocabulary: `sound-by-rejection` means one side was admitted and the other refused
where a consumer needs them distinguished — no false shared identity is issued, and the
honest document still receives one. `rejection-asymmetry` is the failure mode of a strict
rule: refusing one of two documents every consumer treats as identical. The mitigation arm
scores **0** on that, which is what makes it a fix rather than a trade.

Per-class result for Ghost-Ark's own pipeline:

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

**F1.1 — Ghost-Ark's own pipeline has three unintended kernel members.** `{"amount":1,"amount":2}`
and `{"amount":2}` receive the same receipt identity. So do two integers one apart above
2^53, and two distinct decimal literals that round to the same double. All three
collapses happen inside `JSON.parse`, before any Ghost-Ark code executes.

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

Measured effect: **unintended kernel members 3 → 0**, with **zero** rejection-asymmetry.

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

**F4.3 — `receipt_id` cannot be isolated by this corpus, and the reason is a threat-model
gap.** Every fixture that mutates `receipt_id` also breaks the digest and signature, so
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
2. **No compromised-signer fixtures.** Blocks isolation of 5 of 10 verifier checks (F4.3).
3. **No live AWS evidence bundle.** Every AWS-path claim is synth-only or local-only.
4. **E1's randomized arm is not built.** Only the census arm exists, so no experiment here
   currently earns a confidence interval. Building it is the only way to get one honestly.
5. **No cross-machine reproduction of E2.** Single host only.
6. **CI does not run the Rust or TLA+ artifacts on every commit** — see
   [../artifact/CI_COVERAGE.md](../artifact/CI_COVERAGE.md) for the exact matrix.
