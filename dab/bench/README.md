# dab/bench — QUARANTINED: not evidence about Ghost-Ark

**Status: self-consistency smoke tests of a modeled attacker. NOT measurements of any
Ghost-Ark component.**

Audited 2026-07-29. Do not cite any output of this directory as evidence for any claim.
For real measurements use [`docs/research/EXPERIMENTS.md`](../../docs/research/EXPERIMENTS.md)
and `npm run experiments`.

## Why this directory is quarantined

Several suites here report `detected: true` without invoking any Ghost-Ark component. The
"detection" is a restatement of how the test's own fixtures were constructed.

**`attacks/concurrency.ts` — `nonceSwapAttack`**

```ts
detected:
    requestA.payload !== requestB.payload
    &&
    requestA.nonce === requestB.nonce,
```

The function builds two requests with different payloads and the same nonce, then asserts
the payloads differ and the nonces match. Both are true by construction. No nonce ledger,
gateway, or verifier is consulted. It also emits `ci: "sha256:A"` and `ci: "sha256:B"` —
hardcoded strings that are not hashes, which were then quoted in the dissertation as "Raw
Benchmark Output".

**`attacks/replay.ts` — `replayAttack`**

Consults `usedNonces`, a `Set` declared in the benchmark file. It measures that
`Set.prototype.has` works. The Rust tombstone ledger in `dab/gateway/src/nonce.rs` is never
invoked, yet the dissertation cited this as evidence that "the Rust gateway's Mutex-backed
`NonceLedger` cleanly survived a `double_execution_race`".

**`attacks/unicode.ts`**

`unicode_normalization_collision` asserts `original !== decomposed && NFC(original) === NFC(decomposed)`,
which is a true statement about `String.prototype.normalize` — a property of the JavaScript
standard library, not of Ghost-Ark. `unicode_homoglyph_spoof` asserts
`"paypal.com" !== "paypaⅼ.com"`, true because the code points differ. Neither exercises any
Ghost-Ark canonicalizer. E1 measures what these were supposed to: Ghost-Ark
**over-discriminates** NFC/NFD, and Unicode handling **diverges across runtimes**.

**`attacks/mutation.ts`**

The soundest suite here: it computes real digests over real inputs. But
`payload_field_mutation` and `single_byte_flip` demonstrate SHA-256's avalanche property —
a property of SHA-256, not of Ghost-Ark. A 100% result is expected for any correct hash.

## What is legitimate here

- `performance.ts` produces real timing data. It has no dispersion reporting or baseline
  discipline; **E2 supersedes it** for anything quoted.
- `formal_games.ts` computes advantage bounds over its own declared model. Read it as a
  model-internal calculation, not a measurement of the implementation.
- `run_all.ts` is honest about itself: its header already states that a green result
  "demonstrates in-suite detection under the modeled attacker only".

## The discriminator, if you want to fix a suite here

A genuine detector **stops detecting when the mechanism it depends on is broken**. A
tautological one does not. That is exactly the test `npm run experiment:e4` applies to the
real verifier, and
`tests/unit/experiments/metamorphicGuard.test.ts` contains a worked
tautological-vs-genuine pair. To rehabilitate a suite in this directory, make it invoke a
real component and show its result flips when that component is neutered.

`tests/unit/repo-hygiene/benchQuarantine.test.ts` asserts this README stays in place and
that no CI workflow treats this directory as a source of evidence.
