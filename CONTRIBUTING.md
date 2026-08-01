# Contributing to Ghost-Ark

This repository is a research artifact. Its value is not the code — it is that a
reviewer who distrusts the author can still check the claims. Every rule below
exists to protect that property, and every one of them was written after this
repository violated it and the violation was caught in audit.

Read this before your first pull request. It takes about ten minutes and it will
save you a rejected review.

## The one-paragraph version

Ghost-Ark provides cryptographic receipts and bounded governance evidence. It
verifies what was recorded, signed, policy-bounded, and replayable under
Ghost-Ark verifier rules. It does **not** establish semantic safety, truth,
regulatory compliance, alignment, production readiness, or deployment
correctness. If a change you are making would require the second sentence to be
weakened, that change is out of scope regardless of how well it works.

## Before you start

```bash
npm ci
npm run validate
```

`npm run validate` is lint + full test suite + docs check + claim scan +
assumption lattice. It must pass on a clean clone before you change anything, so
that a later failure is unambiguously yours.

If it does not pass on a clean clone, that is a bug worth reporting on its own —
say so in an issue rather than working around it.

## What must never be weakened

These are not style preferences. A pull request that weakens any of them will be
rejected on sight, and several are enforced by tests that will fail before a
human sees the change.

**Receipt canonicalization.** Canonical JSON must stay deterministic. Do not
change the semantic multiplicity of a v1 field (`action_taken` is the standing
example) without a schema migration. Do not claim RFC 8785 / JCS compliance
unless it is actually implemented and tested — it is not, today.

**Signature validation.** Signing proves signing authorization over the receipt
payload. It does not establish that the AI output is true or safe. Local HMAC is
development-only. KMS key identifiers in verification-critical paths must be
immutable key ARNs, not mutable aliases, because an alias can be repointed after
the fact and a receipt that verifies under a repointable identity proves less
than it appears to.

**Tenant boundary checks.** Client-declared tenant, user, or session identity is
never accepted. Tests in `tests/security/` pin this.

**Fail-closed behavior.** When the runtime cannot establish that an action is
permitted, it must refuse. A change that converts a refusal into a default-allow
needs an explicit, argued justification in the PR body.

**The claim gate.** `npm run scan:claims` blocks forbidden assurance wording on
public claim surfaces. Do not add your file to the allowlist to make the scanner
quiet. The allowlist is for documents whose *purpose* is to quote forbidden
wording — policy and boundary docs — and each entry carries a comment saying
why. If you need an entry, argue for it in review.

## The empirical rules

Ghost-Ark reports measurements. These rules govern how. They are binding, and
`docs/research/EXPERIMENTS.md` records the incident behind each.

**No point estimate without a dispersion measure.** Latency is p50 with IQR,
never a bare p50.

**No proportion without its denominator, and no detection rate without a control
arm.** A verifier that rejects everything scores 100% detection and is worthless.
The control arm is what makes the number mean anything.

**No confidence interval over a curated census.** A confidence interval describes
sampling variability under repeated random draws. A hand-authored corpus has
none — it is the whole population, and its size is an authoring decision. Use
`reportProportion` with provenance `"census"` and give exact counts. A Wilson
interval was once computed at n = 2 and presented as a robust lower bound; at 2/2
that bound sits below 0.4.

**No interval below n = 30** (`MIN_N_FOR_PROPORTION_INTERVAL`), even for genuine
random samples.

**No hypothesis selected from the same data used to bound it.** Discovery and
confirmation are separate tiers. The CC-Framework carried a post-selection
confidence interval defect; it was real, and it is fixed.

**Pre-register intent before measuring.** E1's consumer intents live in
`tools/experiments/kernelAlphabet.ts` and E10's scope in
`tools/experiments/mutationScope.ts`, both pinned by tests, so editing one to
match a result surfaces in review rather than in the number.

**State the host for any timing claim.** A latency figure without a machine is
not reproducible.

**Report what was not measured.** A silently dropped arm makes the system look
better than it is — and it does so quietly. When E1's Python arm became
unavailable it did not error; it changed the headline
`universal_unintended_kernel` count from 4 to 5 and exited 0. E1 now refuses to
emit a census with a missing arm unless degradation is requested explicitly.

**A detection benchmark must invoke a real component.** Apply the E4
discriminator: break the mechanism, confirm detection stops. If a check would
still report "detected" with its dependency broken, it is tautological and
measures nothing. `dab/bench` is quarantined for exactly this defect — do not add
benchmarks there.

**Never present a placeholder as measured output.** The string `sha256:A` once
appeared under a heading reading "Raw Benchmark Output", emitted by the benchmark
itself.

## Maturity tiers — label your work

Every claim in this repository carries a tier. Mixing them is the most common way
an honest artifact becomes a dishonest one.

| Tier | Means |
|:---|:---|
| `local-only` | Runs and is tested on a developer machine. No cloud path. |
| `AWS-synth-only` | CDK/Terraform synthesizes and is asserted. Never deployed. |
| `AWS-live` | Executed against real AWS with recorded evidence. |
| `research-only` | Prototype or model. Not on any trusted path. |
| `aspirational` | Designed, not built. Say so in the same sentence. |
| `non-claim` | Explicitly disclaims something. |

Never state that the full cloud path exists without live AWS evidence.

## Never claim

Not in code, comments, docs, commit messages, or PR descriptions:

production-ready · safe AI · proves safety · compliant · compliance-certified ·
formally verified · trustless · zero-knowledge · secure by default · prevents all
attacks · guarantees safety · absolute-security language · deployment-safety
certification · production enclave security

These are permitted only inside an explicit limitation, warning, policy,
research-only, or non-claim context — which is what the allowlisted boundary
documents are for.

## Validation

For an ordinary change:

```bash
npm run lint
npx vitest run <the-test-file-you-touched>
```

For a change touching the trust kernel, schemas, canonicalization, signing,
verification, or tenancy:

```bash
npm run validate
```

Never report success without command output. If you could not run something, say
which thing and why — an unstated gap is worse than a stated one.

### Experiments

```bash
npm run experiments          # E1, E1-B, E2 – E7
npm run test:experiments     # the tests that pin them
npm run mutation             # E10, slow — see docs/research/EXPERIMENTS.md
```

The Rust, TLA+, and Python artifacts have their own gates:

```bash
cargo test --locked --manifest-path dab/Cargo.toml
tools/proofs/run-tlc.sh
.venv/bin/python -m pytest
```

## Pull requests

Fill in `.github/PULL_REQUEST_TEMPLATE.md` honestly, especially:

- **Validation Commands Run** — the exact commands, with their output available.
- **Non-Claims** — what a reader might wrongly infer, stated so they cannot.
- **Classification** — which maturity tier the change lands in.

State what you did not do. A PR that says "the socket round-trip is recorded, not
CI-reproduced" is stronger than one that leaves the reader to discover it.

## Reviewing

The reviewer's job is not to check that the code works. It is to check that the
repository still says only what it can support. Concretely, ask:

1. Does any new sentence claim more than the evidence beneath it?
2. Does any new number carry a denominator, a dispersion measure, and a host?
3. Would the new test still pass if the mechanism it tests were broken?
4. Is anything newly quarantined, dropped, or unmeasured — and is it stated?

## Relationship to `CLAUDE.md`

`CLAUDE.md` states the same operating rules for AI coding assistants working in
this repository. It is intentionally near-duplicative. Where the two disagree,
**this file governs for humans and `CLAUDE.md` governs for assistants**, and the
disagreement is a bug — fix both in the same commit.

## North star

A skeptical reviewer should be able to say: I do not trust the author, I do not
trust the README, I do not trust the model — but I can inspect the receipt,
replay the canonical digest, verify the signature, map the claim to evidence,
inspect the non-claim, and reproduce the failure boundary.

Every contribution should leave that sentence more true than it found it.
