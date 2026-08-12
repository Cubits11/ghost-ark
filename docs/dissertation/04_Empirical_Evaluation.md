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

| ID | Retracted | Why |
|:---|:---|:---|
| **R1** | DAB Tier-0 detection results as evidence about Ghost-Ark | The nonce-swap "detection" was computed as `requestA.payload !== requestB.payload && requestA.nonce === requestB.nonce` — true by construction. `replayAttack` consults a local `Set` declared in the benchmark file, not the Rust nonce ledger. |
| **R2** | "The Rust gateway's Mutex-backed `NonceLedger` cleanly survived a `double_execution_race`" | The cited benchmark is TypeScript and never invokes the Rust gateway. |
| **R3** | "Unicode spoofing is entirely eradicated at the TCB boundary" | An absolute-security claim whose evidence was a TypeScript *compile error* in a benchmark that did not execute. E1 finds Unicode handling diverges across runtimes. |
| **R4** | A Wilson confidence interval at n = 2 described as a "robust statistical lower bound" | At 2/2 successes the Wilson lower bound is below 0.4 — consistent with a true rate of one in three. Now structurally prevented. |
| **R5** | `"ci": "sha256:A"` / `"sha256:B"` in "Raw Benchmark Output" | Not hashes. Hardcoded placeholders emitted by the benchmark itself. |
| **R6** | "Mitigations implemented for Zero-Days 1, 3, 4, 5" | The `ghost_ark_ring0.bpf.c` banner. The file has never been compiled or loaded. Quarantined to `dab/gateway/UNBUILT_PROTOTYPES/` with a correction in place. |
| **R7** | A pinned `tla2tools.jar` sha256 presented as toolchain integrity | The digest was recorded 2026-07-15 for a release first published 2026-07-31 — the URL returned 404 on the day it was pinned, so it can never have been computed from the file it claims to pin. The proof stage checked zero specifications for sixteen days while a second runner fetched the same jar with no integrity check at all. |
| **R8** | Nitro Enclave PCR attestation as an implemented path | `dab/gateway/src/v200.rs` never compiled on Linux (a bulk `DescribePCRs` API that does not exist), and off-Linux its mock returned the exact constant the check compares against — so attestation passed unconditionally on the development host. Quarantined. |
| **R9** | `prototype_pollution: detected: false` used to argue the V8 runtime is hostile | The fixture never exercised a prototype-pollution path, so a `false` result argued nothing about the runtime either way. (An earlier wording of this row said the suite "now reports `detected: true`" — that rehabilitated a suite living inside the quarantined `dab/bench`, contradicting R1. No result from that directory is evidence here.) |
| **R10** | Every headline latency and detection number in the conference manuscript, `docs/paper/main.tex` | The paper drew `global_advantage: 0` and an end-to-end `p50 = 5.5 µs` from `dab/bench/`, whose own README reads "QUARANTINED: not evidence about Ghost-Ark". R1 is exactly this defect — but R1 was recorded against *this chapter* and never propagated to the *paper*, which carried no retraction section at all. Superseded by E2 (p50 with IQR, parse-only baseline) and E3/E4 (real verifier, control arm, metamorphic guard); the throughput figure and stage decomposition are withdrawn without replacement, since no superseding experiment measures them. |
| **R11** | The four TLA+ mutant `distinct_states` counts (`63 / 396 / 22 / 221`) as reproducible figures | A mutant halts at the first counterexample and TLC runs `-workers auto`, so the count depends on thread scheduling, not on the model. Measured n=10 on one host at one commit: 61–63, **193–431**, 22–23, **185–332**. Baseline counts are exhaustive and *are* stable (403,949 / 529 / 64 / 1,321 / 51,106, reproduced under a changed toolchain). The `VIOLATION_REPRODUCED` gate is unaffected and remains sound; only the counts are withdrawn. Full detail in EXPERIMENTS.md. |

Every row above carries an ID matching
[EXPERIMENTS.md §Retractions](../research/EXPERIMENTS.md#retractions), which is
the source of record. `tests/unit/repo-hygiene/retractionSync.test.ts` fails if
the two sets diverge. R6–R8 were absent from this chapter until 2026-08-02, and
R9 was absent from that table — the drift ran in both directions. R10 records a
third instance of the same pattern found on 2026-08-02: a retraction held in
both of these lists that had never reached `docs/paper/`, a document neither
list was checked against.

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

31 pre-registered pathology classes, each a pair of byte-distinct raw JSON documents with a
consumer intent declared *before* any arm was run, evaluated across five independent
`parse → canonicalize → digest` pipelines. Provenance is **census**: exact counts, no
intervals. Re-measured 2026-08-02; the table below previously recorded a 12-class, 4-arm
run and had not been updated as the alphabet grew.

| arm | independent parser | sound | unintended-kernel | over-discrim | fail-closed | sound-by-rejection | rej-asym |
|:---|:---|---:|---:|---:|---:|---:|---:|
| `ghost-ark-receipt-schema` | no | 23 | 5 | 1 | 1 | 1 | 0 |
| `ghost-ark-independent-verifier` | no | 23 | 5 | 1 | 1 | 1 | 0 |
| `ghost-ark-strict-admission` | no | 23 | **0** | 1 | 2 | 5 | 0 |
| `naive-sorted-stringify` (control) | no | 23 | 6 | 1 | 0 | 1 | 0 |
| `python-json-sorted` | yes | 21 | 4 | 3 | 1 | 2 | 0 |

**Result 1. Ghost-Ark's unguarded pipeline contains five unintended kernel members**, four of
which are *universal* — collapsed against declared intent by every arm that decides them:
`duplicate-key-last-wins`, `decimal-literal-collapse`, `nested-duplicate-key-in-array`, and
`duplicate-empty-key`. The fifth, `integer-precision-loss`, is Ghost-Ark-specific in the sense
that `python-json-sorted` scores *sound* on it through arbitrary-precision integers.
`{"amount":1,"amount":2}` and `{"amount":2}` receive the same receipt identity; so do two
integers one apart above 2^53. Every one of these collapses occurs inside `JSON.parse`, before
any Ghost-Ark code executes.

**Result 1b. Strict admission takes that count to zero** without changing `canonicalize()`
byte-for-byte: the `ghost-ark-strict-admission` arm carries 0 unintended kernel members, moving
five classes to `sound-by-rejection`. Rejection asymmetry is 0 across every arm.

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

30 hand-authored single-field mutations run through `verifiers/node/ghost_receipt_verify.mjs`
— the actual standalone verifier, not a reconstruction. Provenance census; exact counts.
Re-measured 2026-08-02; the figures below had gone stale as the corpus grew.

```
aggregate detection:     28/28   DETECTABLE mutations rejected somewhere in the pipeline
documented boundaries:      2    fixtures the corpus declares should be ACCEPTED
verifier-intrinsic:      26/26   rejected by verifier rules alone
control arm:              3/3    unmutated base fixtures PASS

strata: verifier-intrinsic 25 | load 1 | consumer-expectation 2 |
        documented-boundary 2 | undetected 0
```

The defensible figure is **26/26 verifier-intrinsic**, not the aggregate: the aggregate
folds in a fixture that no verifier rule can reject. The two documented boundaries are
fixtures the corpus declares *should* be accepted; they are held out of the rate rather
than counted as detections, since rewarding correct acceptance inside a detection metric
would inflate it.

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
