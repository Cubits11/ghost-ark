## PART VI — EMPIRICAL EVALUATION

This chapter was rewritten on 2026-07-29. The previous version presented results from
`dab/bench/attacks/` as empirical evidence about Ghost-Ark. An audit found that several of
those "attacks" were tautological — they asserted properties of their own fixtures and
invoked no Ghost-Ark component — and that the chapter contained a hardcoded placeholder
inside a block labelled "Raw Benchmark Output". Those claims are retracted below rather
than deleted, and replaced with measurements from experiments E1–E4.

**Authoritative source of record:** [../research/EXPERIMENTS.md](../research/EXPERIMENTS.md).
Every figure in this chapter is regenerable with `npm run experiments`. Where this chapter
and that document disagree, that document is correct.

### 6.0 Retractions

| Retracted | Why |
|:---|:---|
| DAB Tier-0 detection results as evidence about Ghost-Ark | The nonce-swap "detection" was computed as `requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce` — true by construction. `replayAttack` consults a local `Set` declared in the benchmark file, not the Rust nonce ledger. |
| "The Rust gateway's Mutex-backed `NonceLedger` cleanly survived a `double_execution_race`" | The cited benchmark is TypeScript and never invokes the Rust gateway. |
| "Unicode spoofing is entirely eradicated at the TCB boundary" | An absolute-security claim whose evidence was a TypeScript *compile error* in a benchmark that did not execute. E1 finds Unicode handling diverges across runtimes. |
| A Wilson confidence interval at n = 2 described as a "robust statistical lower bound" | At 2/2 successes the Wilson lower bound is below 0.4 — consistent with a true rate of one in three. Now structurally prevented. |
| `"ci": "sha256:A"` / `"sha256:B"` in "Raw Benchmark Output" | Not hashes. Hardcoded placeholders emitted by the benchmark itself. |
| `prototype_pollution: detected: false` used to argue the V8 runtime is hostile | Stale. The suite now reports `detected: true`; the argument rested on an outdated run. |

### 6.1 Reporting contract

Binding on every figure in this chapter, because each rule was previously violated:

1. No point estimate without a dispersion measure (p50 is always paired with IQR).
2. No proportion without its denominator and its control arm.
3. **No confidence interval over a curated census.** A CI describes sampling variability
   under repeated random draws; a hand-authored corpus has none. Enforced in code by
   `reportProportion`, which refuses to attach an interval when provenance is `census`.
4. No interval below n = 30 even for genuine random samples.
5. The measurement host is recorded.
6. Arms that were not measured are reported, with the reason.

### 6.2 The provenance kernel of Ghost-Ark's own canonicalizer (E1)

12 pre-registered pathology classes, each a pair of byte-distinct raw JSON documents with a
consumer intent declared *before* any arm was run, evaluated across four independent
`parse → canonicalize → digest` pipelines. Provenance is **census**: exact counts, no
intervals.

| arm | independent parser | sound | unintended-kernel | over-discrimination | fail-closed | split |
|:---|:---|---:|---:|---:|---:|---:|
| `ghost-ark-receipt-schema` | no | 7 | 3 | 1 | 1 | 0 |
| `ghost-ark-independent-verifier` | no | 7 | 3 | 1 | 1 | 0 |
| `naive-sorted-stringify` (control) | no | 7 | 4 | 1 | 0 | 0 |
| `python-json-sorted` | yes | 6 | 2 | 2 | 1 | 1 |

**Result 1. Ghost-Ark's own pipeline contains three unintended kernel members.**
`{"amount":1,"amount":2}` and `{"amount":2}` receive the same receipt identity; so do two
integers one apart above 2^53, and two distinct decimal literals rounding to one double.
All three collapses occur inside `JSON.parse`, before any Ghost-Ark code executes.

**Result 2. The kernel is a property of the pipeline, not the canonicalizer.** On
`integer-precision-loss` the three V8 arms are unsound and the CPython arm is *sound* —
identical canonicalization rules, different parser, opposite verdict. This is the chapter's
central empirical claim: auditing a canonicalizer in isolation cannot find this class of
defect.

**Result 3. Fail-closed rejection is load-bearing, and the comparison proves it.** On
`non-finite-overflow` Ghost-Ark rejects both documents. The naive control arm — the
serializer a competent engineer writes in ten minutes — assigns `1e400` and `1e401` the
*same digest*, because `JSON.stringify(Infinity)` yields `"null"`. Ghost-Ark's refusal to
emit an identity is the difference between a rejection and a false shared identity.

**Result 4. Cross-runtime receipt verification is not sound today.** Four divergences, each
of which breaks a receipt verified in one runtime and re-verified in another. Notably,
CPython round-trips a lone surrogate into a canonical form that has **no UTF-8 encoding**
and therefore cannot be digested at all.

**Result 5. The defects are fixed, and the fix is measured by the census that found them.**
All three collapses occur inside `JSON.parse`, so no change to the canonicalizer could
address them; the guard has to inspect the raw text. `strictJsonAdmission.ts` rejects
duplicate object keys at any depth, integer literals above 2^53−1, and numeric literals with
more than 17 significant digits. Measured on the same alphabet:

| arm | unintended-kernel | rejection-asymmetry |
|:---|---:|---:|
| `ghost-ark-receipt-schema` (unguarded) | 3 | 0 |
| `ghost-ark-strict-admission` (guarded) | **0** | **0** |

Two properties make this a fix rather than a trade. It is **additive** — `canonicalize()` is
untouched, every existing receipt identity and signature is byte-identical, and no schema
migration is required. And it costs no availability: zero rejection-asymmetry means no
semantically-equivalent document was refused. The rule deliberately does not demand exact
representability, which would reject `0.1` and be unusable, nor a canonical numeric form,
which would reject `1e2`; it targets over-precision only.

The dual defect remains open. `unicode-nfc-vs-nfd` over-discrimination is not addressed,
because fixing it means choosing a normalization policy for signed string values, which
changes what gets signed and does require a receipt schema migration.

Coverage boundary: the alphabet is hand-curated and adversarial. It establishes that these
collapses are possible and present, **not** how frequently they occur in real traffic. That
remains the largest open gap in this work.

### 6.3 Cost of verification (E2)

Host: Apple M1, darwin/arm64, 8 CPU, Node v22.22.3. 5000 measured iterations after 500
discarded warmup iterations. Canonical payload 1552 bytes. Baseline `json-parse-only`.

| operation | crypto | p50 µs | IQR µs | p95 µs | ×baseline |
|:---|:---|---:|---:|---:|---:|
| `json-parse-only` | none | 1.92 | 0.13 | 2.04 | — |
| `canonicalize-only` | none | 6.46 | 2.17 | 10.29 | 3.37× |
| `canonicalize-and-digest` | hash | 7.63 | 0.38 | 8.63 | 3.98× |
| `hmac-verify` | symmetric | 9.63 | 1.92 | 15.00 | 5.02× |
| `verifier-full-hmac` | symmetric | 23.21 | 5.29 | 31.13 | 12.11× |
| `verifier-full-rsa-pss` | asymmetric | 126.25 | 8.46 | 193.46 | 65.89× |

Asymmetric verification dominates at ~5.4× the full HMAC path. Canonicalization is not the
bottleneck. Units are microseconds: the historical reporting error in this chapter was a
unit error of three orders of magnitude, so units are now carried in every field name.

The harness audits its own plausibility: it declares subset relationships between arms (a
superset cannot be cheaper than its subset) and reports violations instead of publishing
impossible orderings. That audit caught a real defect in an earlier version of the harness
itself — an O(n) result sink that made `canonicalize-only` appear slower than
`canonicalize-and-digest`.

These are single-host, single-process, no-concurrency figures. They are not throughput
numbers and not a performance guarantee.

### 6.4 Adversarial corpus, against the real verifier (E3)

26 hand-authored single-field mutations run through `verifiers/node/ghost_receipt_verify.mjs`
— the actual standalone verifier, not a reconstruction. Provenance census; exact counts.

```
aggregate detection:     26/26   rejected somewhere in the pipeline
verifier-intrinsic:      25/25   rejected by verifier rules alone
control arm:              3/3    unmutated base fixtures PASS

strata: verifier-intrinsic 24 | load 1 | consumer-expectation 1 | undetected 0
```

The defensible figure is **25/25 verifier-intrinsic**, not the aggregate: the aggregate
folds in a fixture that no verifier rule can reject.

That fixture, MAL-014, is the thesis in miniature. It is a byte-identical,
cryptographically valid receipt from tenant A presented to a tenant-B consumer. The receipt
is *correct*; no rule can reject it. Only the consumer's declared expectation distinguishes
it. This is `Sound(C, Σ, P)` depending on `P` — the same receipt sound for one consumer set
and unsound for another, with the canonicalizer unchanged.

The control arm is what makes the detection figure meaningful: a verifier that rejected
everything would score 100% while being useless.

Coverage boundary: the corpus contains **no** compromised-signer fixtures, no multi-field
coordinated mutations, no chain- or ledger-level omission attacks, no timing attacks, no
key-rotation-boundary attacks, and no live AWS/KMS custody attacks.

### 6.5 Are the detections load-bearing? (E4)

The question §6.0 forces: how do we know §6.4 is not another tautology? For each of the ten
verifier check names, a mutant verifier is built with that check forced to pass, and the
whole corpus is re-run. A genuine detection stops when its mechanism breaks.

| mutated check | flipped to undetected |
|:---|---:|
| `schema` | 4 |
| `key_id` | 2 |
| `digest` | 1 |
| `signature` | 1 |
| `envelope` | 1 |
| `receipt_id`, `canonical_payload`, `configuration`, `tenant`, `tenant_expectation` | 0 |
| **`ALL` checks forced to pass** | **24 of 25** |

**Tautology verdict: PASS.** With every check neutered, exactly one detection survives, and
it is the malformed-JSON fixture — a parse failure no check mutation can rescue. Five checks
are proven load-bearing with named dependent fixtures.

The five checks that flip nothing are reported as a **corpus gap, not as useless checks**.
`receipt_id` is the instructive case: every fixture that mutates it also breaks the digest
and signature, so isolating it would require a receipt carrying a valid signature over a
mutated payload — an attacker holding the signing key. The corpus does not model a
compromised signer. Authoring those fixtures is the highest-value next step in this chapter.

The guard is itself tested against a known-tautological detector and a known-genuine one, so
that a guard incapable of failing cannot be mistaken for evidence. E4 also refuses to run if
the verifier's check factory no longer matches its mutation anchor, rather than silently
reporting that everything is load-bearing.

### 6.6 What this chapter does not establish

Local measurements of local artifacts under implemented verifier rules. Not live AWS
behavior, not production security, not regulatory compliance, not model safety, not semantic
truth, and not cryptographic strength of the underlying primitives. No live AWS evidence
bundle exists in this repository. The eBPF prototype referenced in earlier drafts is not
compiled and not loaded; see `dab/gateway/UNBUILT_PROTOTYPES/README.md`.
