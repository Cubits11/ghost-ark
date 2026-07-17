// Computable upper bounds on description length — the honest half of Chaitin.
//
// Kolmogorov complexity K(x) is uncomputable, and Chaitin's incompleteness
// theorem says a formal system of complexity c cannot prove K(x) > c for any
// specific x beyond its own constant. Therefore NO monitor can measure K, and
// no monitor can detect that an evaluator has been "outcomplexed." What IS
// computable is one-sided: a lossless compressor C yields
//
//     K(x) <= |C(x)| + O(1)
//
// (the constant is the fixed decompressor's description, which we deliberately
// IGNORE — one more reason any budget must be policy, not derivation). An upper
// bound can certify that x is SIMPLE relative to this toolchain; it can never
// certify that x is complex. That asymmetry is load-bearing for the gate built
// on top of this module (comprehensionGate.ts) and is restated there.
//
// Determinism and replay: byte counts are produced by Node's bundled zlib and
// brotli at fixed settings. Replay is toolchain-relative — the recorded demo
// pins the Node version; a verifier replays with the same runtime.
//
// No maturity annotation: pure computation over supplied bytes, no
// cryptographic or environmental assumption to declare.

import { brotliCompressSync, constants, deflateRawSync } from "node:zlib";

export type CompressorId = "deflate-raw-9" | "brotli-11";

export interface CompressionMeasurement {
  readonly algorithm: CompressorId;
  readonly compressed_bytes: number;
}

export interface UpperBoundWitness {
  readonly raw_bytes: number;
  /** One entry per compressor, sorted by algorithm id for determinism. */
  readonly measurements: readonly CompressionMeasurement[];
  /** min over measurements — the certified upper bound U(x) in bytes. */
  readonly upper_bound_bytes: number;
}

const toBytes = (payload: Uint8Array | string): Uint8Array =>
  typeof payload === "string" ? new TextEncoder().encode(payload) : payload;

/** Compute U(x): the multi-compressor upper bound witness for a payload. */
export function upperBound(payload: Uint8Array | string): UpperBoundWitness {
  const buf = toBytes(payload);
  const measurements: CompressionMeasurement[] = [
    {
      algorithm: "brotli-11" as CompressorId,
      compressed_bytes: brotliCompressSync(buf, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    },
    {
      algorithm: "deflate-raw-9" as CompressorId,
      compressed_bytes: deflateRawSync(buf, { level: 9 }).length,
    },
  ].sort((a, b) => a.algorithm.localeCompare(b.algorithm));
  return {
    raw_bytes: buf.length,
    measurements,
    upper_bound_bytes: Math.min(...measurements.map((m) => m.compressed_bytes)),
  };
}

/**
 * Policy anchor, not a theorem: the budget equal to the evaluator's own
 * certified description bound — "admit nothing you cannot describe more briefly
 * than yourself." Chaitin-INSPIRED shape (a system's blind spot scales with its
 * own description length); the actual Chaitin constant is machine-dependent and
 * unobservable, so this anchor is an arbitrary, explicit policy choice.
 */
export function evaluatorAnchoredBudget(evaluatorSource: Uint8Array | string): number {
  return upperBound(evaluatorSource).upper_bound_bytes;
}
