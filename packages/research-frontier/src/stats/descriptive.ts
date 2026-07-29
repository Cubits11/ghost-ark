/**
 * Zero-dependency descriptive statistics for Ghost-Ark experiment reporting.
 *
 * Why this module exists
 * ----------------------
 * Ghost-Ark previously reported single point estimates ("p50 = X ms") with no
 * dispersion, and in one case computed a Wilson confidence interval at n = 2 and
 * described it as a "robust statistical lower bound". Both are reporting defects.
 * This module supplies the dispersion primitives so experiment code has no excuse
 * to emit a bare point estimate.
 *
 * The inference boundary (read this before using `wilsonInterval` from
 * ../oracle/mEstimator):
 *
 *   A confidence interval describes sampling variability under repeated random
 *   draws from a population. It is meaningful ONLY when the observations are an
 *   actual random sample from a declared distribution.
 *
 *   Ghost-Ark has both kinds of corpora:
 *     - CENSUS corpora  (hand-curated: the 26-receipt malicious corpus, the
 *       pathology-class alphabet). These are the entire population, chosen on
 *       purpose. A CI over them is meaningless: there is no sampling variability
 *       to describe, and the "denominator" is an authoring decision, not a draw.
 *       Report exact counts. `assertCensusReporting` enforces this.
 *     - SAMPLED corpora (randomized generators drawing from a declared
 *       distribution). A CI is legitimate here.
 *
 * Sibling module, not a duplicate: `tools/experiments/src/stats.rs` is the Rust half of
 * this layer. It is dependency-free and carries what a nanosecond-scale timing probe needs
 * and this module does not — median absolute deviation, tie-corrected Mann-Whitney U, a
 * normal CDF, and counter-quantum detection. They are deliberately separate because they
 * serve different harnesses in different languages; if you need a two-sample test, use the
 * Rust one rather than adding a weaker version here.
 *
 * Nothing in this module measures semantic correctness, safety, or compliance.
 */

export type SampleProvenance = "census" | "sampled";

export interface DispersionSummary {
  /** Number of observations. */
  n: number;
  min: number;
  /** 25th percentile (nearest-rank). */
  p25: number;
  /** Median (50th percentile, nearest-rank). */
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  max: number;
  /** Interquartile range, p75 - p25. The dispersion measure we report alongside p50. */
  iqr: number;
  mean: number;
  /** Sample standard deviation (Bessel-corrected, n-1). Null when n < 2. */
  stdDev: number | null;
}

function statsError(message: string): Error {
  return new Error(`ghost_ark.stats: ${message}`);
}

/**
 * Nearest-rank percentile on a sorted ascending array.
 *
 * Deliberately not interpolated: interpolation invents values that were never
 * observed, which is the wrong default for latency evidence that may be replayed
 * and compared digest-for-digest across runs.
 */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) {
    throw statsError("percentile requires at least one observation.");
  }
  if (!(fraction >= 0 && fraction <= 1)) {
    throw statsError("percentile fraction must be within [0, 1].");
  }

  const rank = Math.ceil(fraction * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index] as number;
}

/**
 * Full dispersion summary. Requires n >= 1; `stdDev` is null at n = 1 because a
 * Bessel-corrected variance is undefined there (rather than silently reporting 0).
 */
export function summarize(observations: readonly number[]): DispersionSummary {
  if (observations.length === 0) {
    throw statsError("summarize requires at least one observation.");
  }
  for (const observation of observations) {
    if (!Number.isFinite(observation)) {
      throw statsError("summarize requires finite observations; got a non-finite value.");
    }
  }

  const sorted = [...observations].sort((left, right) => left - right);
  const n = sorted.length;
  const mean = sorted.reduce((total, value) => total + value, 0) / n;

  let stdDev: number | null = null;
  if (n >= 2) {
    const sumSquaredDeviations = sorted.reduce((total, value) => total + (value - mean) ** 2, 0);
    stdDev = Math.sqrt(sumSquaredDeviations / (n - 1));
  }

  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);

  return {
    n,
    min: sorted[0] as number,
    p25,
    p50: percentile(sorted, 0.5),
    p75,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[n - 1] as number,
    iqr: p75 - p25,
    mean,
    stdDev
  };
}

/**
 * Guard against the defect this module was written to prevent: computing an
 * inferential interval over a hand-curated census.
 *
 * Call this before attaching any confidence interval to a proportion. It throws
 * when provenance is "census", forcing the caller to report exact counts instead.
 */
export function assertCensusReporting(provenance: SampleProvenance, context: string): void {
  if (provenance === "census") {
    throw statsError(
      `Refusing to attach a confidence interval to a curated census (${context}). ` +
        "A census has no sampling variability to describe and its denominator is an authoring " +
        "decision, not a random draw. Report exact counts, or re-run the experiment with a " +
        "randomized generator and provenance 'sampled'."
    );
  }
}

/**
 * Minimum n below which a proportion interval is too wide to support any claim.
 *
 * Rationale, and the reason this constant exists: a Wilson 95% interval on 2/2
 * successes is roughly [0.34, 1.00]. That interval is consistent with a true
 * detection rate of one in three. Reporting it as a lower bound on reliability
 * is not conservative, it is uninformative. Experiments must either reach this n
 * or report counts without an interval.
 */
export const MIN_N_FOR_PROPORTION_INTERVAL = 30;

export interface ProportionReport {
  successes: number;
  total: number;
  /** Exact observed proportion. Always reported. */
  observed: number;
  provenance: SampleProvenance;
  /** Present only when provenance is "sampled" AND total >= MIN_N_FOR_PROPORTION_INTERVAL. */
  interval: { low: number; high: number; confidenceLabel: number } | null;
  /** Why an interval is absent, when it is. Never null in that case. */
  intervalOmittedBecause: string | null;
}

/**
 * Report a proportion with an interval only where an interval is defensible.
 *
 * `intervalProvider` is injected so this module keeps no dependency on the
 * M-estimator; pass `wilsonInterval` from ../oracle/mEstimator.
 */
export function reportProportion(
  successes: number,
  total: number,
  provenance: SampleProvenance,
  intervalProvider: (successes: number, total: number) => { low: number; high: number },
  confidenceLabel = 0.95
): ProportionReport {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || successes < 0 || total <= 0 || successes > total) {
    throw statsError("reportProportion requires 0 <= successes <= total and total > 0.");
  }

  const observed = successes / total;

  if (provenance === "census") {
    return {
      successes,
      total,
      observed,
      provenance,
      interval: null,
      intervalOmittedBecause:
        "Curated census: the corpus is the whole population and its size is an authoring decision, " +
        "so there is no sampling variability for an interval to describe."
    };
  }

  if (total < MIN_N_FOR_PROPORTION_INTERVAL) {
    return {
      successes,
      total,
      observed,
      provenance,
      interval: null,
      intervalOmittedBecause: `n = ${total} is below MIN_N_FOR_PROPORTION_INTERVAL = ${MIN_N_FOR_PROPORTION_INTERVAL}; any interval here would be too wide to support a claim.`
    };
  }

  const { low, high } = intervalProvider(successes, total);
  return {
    successes,
    total,
    observed,
    provenance,
    interval: { low, high, confidenceLabel },
    intervalOmittedBecause: null
  };
}
