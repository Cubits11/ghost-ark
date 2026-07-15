# M Estimation Method

Status: research-only. Dependency-free estimator with tests over real reconciler output. No cloud run, no live traffic, no GPU attacker, and no measured field rate exist or are claimed.

## What M is

M = P(unsafe | receipt_valid): among executions whose decision receipt verified, the fraction the independent Effect Oracle flagged as divergent from observed physical effect.

- Denominator: executions whose receipt passed verification. Receipt-invalid executions are excluded — the receipt layer already caught those; they are a different, handled failure mode.
- Numerator: receipt-valid executions the reconciler did not reconcile against the wire (`EXTRA_WIRE_BYTES`, `DIGEST_MISMATCH`, `TRUNCATED`, `AMBIGUOUS_FRAMING`, `UNRECORDED_TRANSIT`, `MISSING_OBSERVATION`).

M is the dangerous quadrant: receipt clean, reality disagrees. It is exactly what a signed receipt cannot self-report, which is why the measuring instrument must be independent (docs/research/PHASE_III_EFFECT_ORACLE.md).

## What M is not

M does not measure semantic truth (Impossibility I2). A low M means receipts matched observed effects on the measured workload; it does not mean tool responses were true, nor that the workload was representative. Calling M a "falsification of semantic truth" is the category error the project exists to avoid — M falsifies the *containment* claim, not a truth claim.

## Estimator

`packages/research-frontier/src/oracle/mEstimator.ts`, tests `tests/differential/mEstimation.test.ts`.

- Point estimate: k / n.
- Interval: Wilson score, two-sided. Closed-form, stable near p = 0, no special functions and no external dependency (no scipy). For the workloads M targets, honest divergence rates sit near zero, which is exactly where a naive Wald interval fails and Wilson does not.
- Zero-divergence case: the rule-of-three upper bound (3/n) is reported alongside the interval.
- Empty denominator: refused. A conditional probability over an empty conditioning set is undefined, not zero.

## Pre-registered falsification rule

The containment claim is falsified at the stated confidence when `wilsonLow > epsilon`, where epsilon is the acceptable divergence ceiling fixed before the data is seen. The estimator requires epsilon as an explicit input for this reason.

Two corrections to the commissioning proposal:

1. Its `stat_sig: ci_low > 0` flag is meaningless. Any non-degenerate interval on a proportion has a lower bound above zero once one event is observed, and a Beta posterior with alpha >= 1 has positive lower density regardless of data. The flag reports "true" for a clean baseline, which is exactly backwards. The meaningful test is against a pre-registered threshold, not against zero.
2. Its Beta(1, 10) prior is informative on the very quantity being measured — it pulls the estimate toward ~0.09 with no data and encodes an unexplained "10". For a falsification instrument, an informative prior on the measurand biases the verdict. The estimator here is frequentist (Wilson) so the reported interval is a function of the data alone; a Bayesian variant, if added, should use a weak or Jeffreys prior and state it.

## Statistical power, honestly

`requiredSampleSizeForFalsification` answers "how many samples do I need for the Wilson lower bound to clear epsilon" at an assumed rate. It is deliberately the tool that REPLACES driving n up on a synthetic corpus rather than the tool that enables it.

The n it returns counts only when each of the n outcomes is an independent draw from the real adversarial distribution. Replaying the same synthetic outcomes n times narrows the interval arithmetically while adding zero real information — it manufactures confidence rather than earning it, the sample-size form of computing an interval from invented counts. A tight interval over a hand-written corpus is not statistical power; it is the same fabrication at higher resolution. When the assumed rate does not exceed epsilon, no finite n suffices and the function says so.

Reaching a peer-review-grade n therefore depends on real data — wiring the runtime to emit receipts over non-synthetic adversarial trajectories — not on iterating this harness.

## Reproduction and ordering

The estimator reproduces the sensible part of the proposal's arithmetic: 345/10000 yields a Wilson 95% interval of approximately [3.11%, 3.83%]; 0/10000 yields a rule-of-three upper bound of 0.0003 and does not falsify containment. The difference is provenance — here those counts, in the corpus test, come from running the reconciler on real wire bytes, not from literals typed into a REPL.

A real M on synthetic local traffic costs zero dollars and runs in the existing test suite. Scaling to cloud-distributed adversarial workloads is a later, separate decision, justified by cost against the marginal statistical power it buys — and made after the local core produces numbers, not before. Scale is not rigor; an interval computed from invented counts is invented at higher resolution.

## Non-Claims

- No cloud, Ray, EKS, eBPF, GPU-attacker, or live-capture component exists or is claimed.
- M values in tests are over a synthetic corpus; they are not field rates.
- M does not evidence safety, alignment, compliance, or semantic truth.
- The falsification rule reports a statistical verdict against a pre-registered threshold on a stated workload; it is not a deployment decision.
