# kernel-probe — standalone

**One file. No install. No dependencies. Nothing from this repository.**

```bash
curl -O https://raw.githubusercontent.com/PSUCyberSecurityLab/ghost-ark/main/tools/kernel-probe/kernel-probe.mjs
node kernel-probe.mjs --command "jq -S -c ."
```

That is the whole setup. Node ≥ 18, one file, and a canonicalizer of your own.

## What it answers

Any system that assigns identity by canonicalization inherits a **kernel**: the
set of input pairs it maps to one identity. Content-addressed stores, SBOM
digests, transparency logs, in-toto and Sigstore attestations, model registries
— all of them answer *"is this the same artifact?"* with a digest over a
canonical form.

A kernel member is a pair of **different documents your system cannot tell
apart**. This tool reports which ones yours has.

It also reports the dual defect, **over-discrimination**: pairs every declared
consumer treats as one fact that your canonicalizer splits. That one breaks
re-verification of evidence nothing actually changed.

## The contract for your canonicalizer

| | |
|:---|:---|
| stdin | one raw JSON document, exactly as transmitted |
| stdout | its canonical form — SHA-256 is computed by the probe, not by you |
| exit 0 | accepted |
| exit ≠ 0 | rejected — a legitimate answer, scored separately from a collapse |

A refusal is **not** a failure. A canonicalizer that declines malformed input is
behaving well, and the report scores that as `sound-by-rejection` or
`fail-closed` rather than folding it into the collapse count.

## Reading the output

| verdict | meaning |
|:---|:---|
| `UNINTENDED-KERNEL` | two documents a declared consumer distinguishes, given one identity. **Usually the row that matters.** |
| `OVER-DISCRIMINATION` | two documents every declared consumer unifies, given two identities |
| `FAIL-CLOSED` | both sides refused. Often correct. |
| `SOUND-BY-REJECTION` | one side refused, and the pair was meant to be distinguishable — admission control working |
| `REJECTION-ASYMMETRY` | one side refused, and the pair was meant to be equivalent — an availability cost |

## You are meant to disagree with some of it

Every pathology ships with a **declared consumer rationale** and a
**pre-registered intent** — fixed before any implementation was run. The intent
is what makes a collapse *unintended* rather than merely *observed*; without it
the tool would only be reporting that two documents hashed the same, which is
not a finding.

If your consumers genuinely do not distinguish a pair, that row is **not a
defect in your canonicalizer**. Say so. The honest move is to disagree with the
intent, not to change it to match a result.

`--emit-alphabet` gives you the whole corpus as JSON so you can score it in your
own language, with your own intents, without this file or Node at all.

## A worked example: one flag changes your kernel

Measured 2026-08-04 with this file, from an empty directory, against stock
CPython 3.14:

```python
# pycanon.py
import json, sys
print(json.dumps(json.load(sys.stdin), sort_keys=True, separators=(",", ":")))
```

```
kernel-probe --command "python3 pycanon.py"
  UNINTENDED-KERNEL 5   fail-closed 0
  non-finite-overflow -> unintended-kernel
```

Add one keyword argument — `allow_nan=False` — and nothing else:

```
kernel-probe --command "python3 pycanon_strict.py"
  UNINTENDED-KERNEL 4   fail-closed 1
  non-finite-overflow -> fail-closed
```

Same library, same version, same input corpus. One flag decides whether your
system can tell `NaN` from a number it was never given. Nobody writing the first
version is thinking about that, and no test suite that checks round-tripping
would catch it, because both versions round-trip correctly.

That is the shape of the finding this tool is for: **not a bug, a boundary you
did not know you had chosen.**

## What this does not tell you

It measures identifiability structure over **one hand-curated adversarial
alphabet** against **one declared consumer set**. It is not a random sample of
JSON, not exhaustive, not a security review, and not a statement that any
canonicalizer is defective. Absence of a class here is not evidence of its
absence in practice, and a clean report is not evidence of safety, correctness,
or compliance.

Findings so far, from the project that produced it: duplicate-key collapse is
universal across `serde_json`, Ruby, CPython, and jq. The 2^53 integer collapse
is **not** universal — it is an artifact of double-backed number models, which
narrowed the original claim.

## For maintainers of this repository

`kernel-probe.mjs` is **generated**. Do not edit it.

```bash
npm run kernel-probe:build      # regenerate from tools/experiments/
npm run kernel-probe:standalone -- --command "jq -S -c ."
```

The alphabet is emitted from `tools/experiments/kernelAlphabet.ts` through the
existing `--emit-alphabet` path rather than copied, and the ~40 lines of verdict
logic are hand-ported from `e1KernelCensus.ts`.
`tests/unit/repo-hygiene/kernelProbeStandalone.test.ts` holds both to the
source: the embedded corpus must equal the in-repo alphabet field for field, and
the ported classifier must agree with the census on every reachable branch. It
also copies the file to a directory outside this repository and runs it there,
which is the acceptance criterion rather than a claim about it.

A copy that ships to strangers and then drifts is worse than no copy, because
the people running it are exactly the people who cannot check.
