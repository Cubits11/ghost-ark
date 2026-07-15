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
