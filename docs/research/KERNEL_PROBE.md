# kernel-probe — which distinctions does your canonicalizer destroy?

Tier: **core**.

This page is for people who do not use Ghost-Ark and have no reason to trust it.

If your system decides "is this the same artifact?" by hashing a canonical form,
it has a **kernel**: the set of genuinely different documents it maps to one
identity. This tool reports yours.

```bash
npm run kernel-probe -- --command "jq -S -c ."
```

It needs no receipt, no AWS, no Ghost-Ark data structure, and no agreement with
anything else in this repository.

## The contract

Your canonicalizer is any program that:

| | |
|:---|:---|
| **stdin** | one raw JSON document, exactly as transmitted |
| **stdout** | its canonical form — the probe computes SHA-256 itself, so you need not agree with it about hashing |
| **exit 0** | accepted |
| **exit ≠ 0** | rejected — a legitimate, often correct answer, scored separately from a collapse |

## What it reports

Each of 31 pre-registered pathology classes is a pair of byte-different JSON
documents with a **declared consumer intent** — whether a reader of that evidence
needs to tell them apart. Every class ships with the rationale, because a
collapse is only a defect relative to somebody who needed the distinction.

| verdict | meaning |
|:---|:---|
| `sound` | behaviour matches the declared intent |
| **`unintended-kernel`** | collapsed a pair a consumer distinguishes — the headline |
| `over-discrimination` | split a pair every consumer unifies; semantically unchanged evidence fails re-verification |
| `fail-closed` | both sides refused; no false identity issued, at an availability cost |
| `sound-by-rejection` | one side refused, intent `distinct` — the goal state for admission control |
| `rejection-asymmetry` | one side refused, intent `equivalent` — a real cost of a strict rule |

`--fail-on-kernel` exits 1 when any unintended kernel member is found, so this
can gate a build.

## Why you might care

Content-addressed stores, SBOM digests, transparency-log entries, in-toto and
Sigstore attestations, and model registries all answer "same artifact?" with a
digest over a canonical form. Measured results from this repository, for scale:

- **Four independent implementations** — Rust `serde_json`, Ruby, CPython, jq —
  each collapse **four** classes from this alphabet, and three duplicate-key
  classes collapse in **all four**. See [EXPERIMENTS.md §E11](./EXPERIMENTS.md).
- **No two of three tested pipelines induce the same equivalence relation**, on
  inputs as ordinary as `1` versus `1.0`. See §E7.
- The `2^53` integer collapse is **not** universal: it is a property of
  double-backed number models, absent from `serde_json`, Ruby, CPython, and
  jq 1.7. An experiment built to generalize that finding narrowed it instead.

## Using the corpus without this repository

```bash
npm run kernel-probe -- --emit-alphabet > pathologies.json
```

Each entry carries `id`, `description`, `rawA`, `rawB`, `intent`, and
`consumerRationale`. Run it in any language; the verdict rules are the table
above and nothing else is required.

## Calibration

The probe is checked against canonicalizers whose kernels are known by
construction (`tests/unit/experiments/kernelProbe.test.ts`):

| target | expected | measured |
|:---|:---|:---|
| always emits one constant | every `distinct` class collapses | 17 unintended-kernel, 0 over-discrimination |
| byte-identical echo | every `equivalent` class splits | 0 unintended-kernel, 14 over-discrimination |
| refuses all input | no identity issued at all | 31 fail-closed, 0 sound |

17 + 14 = 31 exactly, and the two sets are disjoint. A probe whose extremes
overlapped would be miscounting intent. **The refusing case is scored
`fail-closed`, never `sound`** — otherwise a canonicalizer that accepts nothing
would outrank every real one, which is the control-arm problem this repository
states for all detection measurements.

## Interpreting a result honestly

**A clean report is not a pass.** The alphabet is hand-curated and adversarial,
not a random sample of JSON, and absence of a class here is not evidence of its
absence in your traffic.

**A collapse is not a bug report.** Every implementation measured in §E11
behaves exactly as its documentation says. A kernel member means only that a
canonical form identifies two documents *this* declared consumer set would
distinguish. Your consumers may differ — which is the actual finding underneath
all of this: soundness is a relation between a canonicalizer, an input alphabet,
and a consumer set, and it does not persist as consumers are added. See
[PROVENANCE_KERNEL_PROBLEM.md](./PROVENANCE_KERNEL_PROBLEM.md).

**The counts are not a score.** Do not rank implementations by them.

## Non-claim

kernel-probe measures identifiability structure over one hand-curated
adversarial alphabet against one declared consumer set. It is not exhaustive,
not a random sample, not a security review, and not evidence of safety,
correctness, compliance, or production readiness of anything it is pointed at.
