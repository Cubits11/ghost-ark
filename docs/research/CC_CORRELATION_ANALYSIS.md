# CC Correlation Analysis Contract

## Implemented local mechanics

`packages/research-frontier/src/ccCorrelation.ts` implements a bounded, local bridge from receipt-referenced guardrail observations to binary CC variables and a pairwise cohort report. It consumes the guardrail observation contract, a `ghost.discretization_rule_receipt.v1` rule, and an explicit cohort/stationarity scope.

The adapter fails closed when the observation is unbound, names the wrong guardrail, lacks the required score, falls outside the rule domain or validity window, or uses a comparator inconsistent with score polarity. `declared_reference` means the observation carries receipt identifiers; it does not mean this adapter independently verified that receipt or its signature.

The analysis requires a complete rectangular grid: every execution must have exactly one observation for every variable. This prevents silent pairwise deletion from changing denominators. Missing observations, duplicate variables, mixed cohorts, non-binary values, or an absent stationarity declaration are rejected.

## Report contents

`ghost.cc_correlation_report.v1` contains:

- per-variable failure counts and rates;
- 95% Wilson score intervals for each marginal rate;
- a `n00`/`n01`/`n10`/`n11` co-failure table for every variable pair;
- observed joint-failure rates with 95% Wilson intervals;
- empirical phi correlation when both variables have nonzero variance;
- pairwise Fréchet lower and upper bounds from the observed marginals;
- the cohort, missingness policy, stationarity declaration, warnings, and non-claims.

The machine-readable schemas are `schemas/research/cc-binary-observation.schema.json` and `schemas/research/cc-correlation-report.schema.json`. `examples/cc-ghost/correlation-report.example.json` is a four-execution synthetic fixture in which each co-failure cell has count one.

## Fréchet interpretation

For binary failures with marginal rates `pA` and `pB`, the joint-failure probability is bounded by:

```text
max(0, pA + pB - 1) <= P(A=1, B=1) <= min(pA, pB)
```

These bounds follow from probability axioms. They do not identify a copula, establish independence, infer causation, validate stationarity, or predict a future cohort. A narrow interval can result from extreme marginals and is not evidence that upstream measurements are valid.

## Uncertainty boundary

Wilson intervals quantify binomial proportion uncertainty for the finite rows supplied to the report. They do not include uncertainty from sampling design, missing events, score calibration, threshold choice, distribution shift, repeated measures, receipt loss, discretization error, or dependence-model selection. The stationarity field is a producer declaration, not a statistical test.

## Reviewer procedure

1. Run `npx vitest run tests/unit/research-frontier/ccCorrelation.test.ts`.
2. Confirm every source guardrail observation validates under the guardrail schema and excludes raw content.
3. Independently verify the referenced receipts and discretization-rule digests before trusting lineage fields.
4. Confirm the cohort definition, execution uniqueness, complete-grid rule, timestamps, and stationarity scope.
5. Recompute the binary values from the signed comparator and threshold.
6. Recompute every co-failure table, marginal, phi value, Wilson interval, and Fréchet bound.
7. Treat `phi_correlation: null` as an undefined statistic caused by zero variance, not zero correlation.
8. Read warnings and non-claims before using the report in a decision.

## Non-claims

This local analysis does not establish that a guardrail is effective, a score is calibrated, a threshold is appropriate, a cohort is representative, a dependence structure is stable, an output is safe, or an organization satisfies a framework. It is a deterministic reporting primitive over supplied, bounded artifacts.
