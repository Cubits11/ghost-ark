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

- The 26-fixture corpus and the 12-class alphabet are **censuses** — hand-curated, the whole
  population, size chosen by an author. `reportProportion` refuses to attach a confidence
  interval when provenance is `census`, and `assertCensusReporting` throws.
- Intervals are additionally refused below n = 30.

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

### Q10. "Your corpus scores 26/26. That smells like a test written to pass."

It partly is, and E4 says so. Quote **25/25 verifier-intrinsic**, not 26/26 — the aggregate
folds in MAL-014, which no verifier rule can reject.

More damningly, E4 shows **5 of 10 verifier checks have no dependent fixture**: neutering
`receipt_id`, `canonical_payload`, `configuration`, `tenant`, or `tenant_expectation` changes
nothing, because every fixture that mutates `receipt_id` also breaks the digest and the
signature. Isolating that check needs a receipt carrying a *valid signature over a mutated
payload* — an attacker holding the signing key.

**The corpus does not model a compromised signer.** That is a threat-model gap, published in
`EXPERIMENTS.md` §E3 coverage boundary and §E4 finding F4.3, and it is the highest-value
next fixture to author.

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
