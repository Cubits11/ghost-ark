/**
 * M estimator — P(unsafe | receipt_valid), dependency-free.
 *
 * M is the certified-compromise rate: among executions whose decision receipt
 * VERIFIED, the fraction the independent Effect Oracle flagged as divergent
 * from physical reality. Executions whose receipt did NOT verify are excluded
 * from the denominator — the receipt layer already caught those; M is about the
 * dangerous quadrant where the receipt looks clean but the wire disagrees.
 *
 * Independence and toolchain: pure closed-form arithmetic, no scipy, no
 * external dependency. The Wilson score interval is stable near p = 0 and needs
 * no special functions, unlike an exact Beta quantile. Inputs must come from
 * actual reconciler + verifier output, never from hand-entered counts.
 *
 * M does NOT measure semantic truth (Impossibility I2). A low M means receipts
 * matched observed effects on the measured workload; it does not mean the tool
 * responses were true, nor that the workload was representative.
 */

export interface ExecutionOutcome {
  /** Did the decision receipt pass verification (schema, identity, digest, signature)? */
  receiptValid: boolean;
  /** Did the independent Effect Oracle reconcile the receipt against the wire bytes? */
  oracleReconciled: boolean;
}

export interface MEstimateOptions {
  /**
   * Pre-registered acceptable divergence ceiling. The falsification rule fires
   * when the interval's lower bound exceeds epsilon. Required: it must be fixed
   * before the data is seen, not chosen to fit a result.
   */
  epsilon: number;
  /** Two-sided normal quantile; default 95% (z = 1.959963985). */
  z?: number;
  /** Confidence label carried into the report for provenance only. */
  confidenceLabel?: number;
}

export interface MEstimate {
  receiptValidTotal: number;
  unsafeAmongValid: number;
  pointEstimate: number;
  wilsonLow: number;
  wilsonHigh: number;
  confidenceLabel: number;
  epsilon: number;
  /** For zero observed divergences, the rule-of-three upper bound (3/n); else null. */
  ruleOfThreeUpper: number | null;
  /**
   * True when wilsonLow > epsilon: the containment claim is falsified at this
   * confidence. Note this is a real test against a pre-registered threshold,
   * not "the lower bound is above zero" (which is true by construction for any
   * non-degenerate interval and therefore says nothing).
   */
  falsified: boolean;
}

const DEFAULT_Z = 1.959963985;

function estimatorError(message: string): Error {
  return new Error(`ghost_ark.m_estimator: ${message}`);
}

export function wilsonInterval(successes: number, total: number, z = DEFAULT_Z): { low: number; high: number } {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || successes < 0 || total <= 0 || successes > total) {
    throw estimatorError("wilsonInterval requires 0 <= successes <= total and total > 0.");
  }
  const z2 = z * z;
  const denom = total + z2;
  const center = (successes + z2 / 2) / denom;
  const half = (z / denom) * Math.sqrt((successes * (total - successes)) / total + z2 / 4);
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half)
  };
}

/**
 * Continuous Wilson score lower bound for a proportion p at sample size n.
 * Algebraically identical to wilsonInterval's lower bound when p = k/n, but
 * defined for real-valued p so power analysis is not distorted by rounding an
 * assumed rate to an integer success count at small n.
 */
export function wilsonLowerBound(p: number, n: number, z = DEFAULT_Z): number {
  if (!Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(n) || n <= 0) {
    throw estimatorError("wilsonLowerBound requires p in [0,1] and n > 0.");
  }
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (center - margin) / denom);
}

export function estimateFromCounts(unsafeAmongValid: number, receiptValidTotal: number, options: MEstimateOptions): MEstimate {
  if (!Number.isFinite(options.epsilon) || options.epsilon < 0 || options.epsilon > 1) {
    throw estimatorError("epsilon must be a pre-registered value in [0, 1].");
  }
  if (receiptValidTotal <= 0) {
    throw estimatorError("M is undefined: cannot condition on an empty receipt-valid set.");
  }
  if (!Number.isSafeInteger(unsafeAmongValid) || unsafeAmongValid < 0 || unsafeAmongValid > receiptValidTotal) {
    throw estimatorError("unsafeAmongValid must be an integer in [0, receiptValidTotal].");
  }

  const z = options.z ?? DEFAULT_Z;
  const wilson = wilsonInterval(unsafeAmongValid, receiptValidTotal, z);

  return {
    receiptValidTotal,
    unsafeAmongValid,
    pointEstimate: unsafeAmongValid / receiptValidTotal,
    wilsonLow: wilson.low,
    wilsonHigh: wilson.high,
    confidenceLabel: options.confidenceLabel ?? 0.95,
    epsilon: options.epsilon,
    ruleOfThreeUpper: unsafeAmongValid === 0 ? 3 / receiptValidTotal : null,
    falsified: wilson.low > options.epsilon
  };
}

export function estimateM(outcomes: readonly ExecutionOutcome[], options: MEstimateOptions): MEstimate {
  if (!Array.isArray(outcomes)) {
    throw estimatorError("outcomes must be an array of ExecutionOutcome.");
  }
  const receiptValid = outcomes.filter((outcome) => outcome.receiptValid === true);
  const unsafeAmongValid = receiptValid.filter((outcome) => outcome.oracleReconciled === false).length;
  return estimateFromCounts(unsafeAmongValid, receiptValid.length, options);
}

export interface SampleSizeQuery {
  /** Assumed true divergence rate (e.g. a pilot point estimate). */
  observedRate: number;
  /** Threshold the Wilson lower bound must exceed to falsify containment. */
  epsilon: number;
  z?: number;
  /** Upper search bound; the answer is null if no n up to maxN suffices. */
  maxN?: number;
}

export interface SampleSizeResult {
  achievable: boolean;
  requiredN: number | null;
  detail: string;
}

/**
 * Power analysis: the smallest n at which the Wilson lower bound exceeds
 * epsilon, given an assumed divergence rate. This is the honest answer to "how
 * many samples do I need" — and it is the tool that replaces, rather than
 * enables, driving n up on a synthetic corpus.
 *
 * The n it returns only counts when each of the n outcomes is an INDEPENDENT
 * draw from the real adversarial distribution. Replaying the same synthetic
 * outcomes n times narrows the interval arithmetically while adding zero real
 * information: it manufactures confidence rather than earning it. If
 * observedRate <= epsilon, no finite n can push the lower bound past the
 * threshold, and the query is reported as not achievable.
 */
export function requiredSampleSizeForFalsification(query: SampleSizeQuery): SampleSizeResult {
  if (!Number.isFinite(query.observedRate) || query.observedRate < 0 || query.observedRate > 1) {
    throw estimatorError("observedRate must be in [0, 1].");
  }
  if (!Number.isFinite(query.epsilon) || query.epsilon < 0 || query.epsilon >= 1) {
    throw estimatorError("epsilon must be in [0, 1).");
  }
  const z = query.z ?? DEFAULT_Z;
  const maxN = query.maxN ?? 1_000_000;

  if (query.observedRate <= query.epsilon) {
    return {
      achievable: false,
      requiredN: null,
      detail: `observedRate ${query.observedRate} does not exceed epsilon ${query.epsilon}; the Wilson lower bound converges to the rate and can never clear the threshold.`
    };
  }

  for (let n = 1; n <= maxN; n += 1) {
    if (wilsonLowerBound(query.observedRate, n, z) > query.epsilon) {
      return {
        achievable: true,
        requiredN: n,
        detail: `At n=${n} independent trials with rate ${query.observedRate}, the Wilson lower bound exceeds epsilon ${query.epsilon}.`
      };
    }
  }
  return {
    achievable: false,
    requiredN: null,
    detail: `No n up to ${maxN} pushes the Wilson lower bound past epsilon ${query.epsilon} at rate ${query.observedRate}.`
  };
}
