// GHOST-CHAITIN-V1 — cryptographic witnesses for comprehension-gate verdicts.
//
// A receipt records: the payload digest, the policy budget B, the full
// compression witness (per-algorithm byte counts and the derived upper bound),
// and the verdict. Verification is layered:
//   structural  — digest, signature, min-correctness of the witness, and
//                 verdict/budget consistency, from the receipt alone;
//   replay      — given the payload bytes, recompute every measurement with the
//                 same toolchain and require exact agreement.
// An attacker who fakes simplicity (doctored byte counts) and honestly re-signs
// still fails replay — rejected on evidence, not signature. Replay is
// toolchain-relative (Node's zlib/brotli); recorded artifacts pin the runtime.
//
// A receipt certifies that boundary code reached this verdict over these bytes
// under this budget. It does not certify the payload safe, simple in the true
// Kolmogorov sense, or evaluable by any particular assessor.

import { createHash, createHmac } from "node:crypto";
import { danf } from "../lobian/receipt";
import { type UpperBoundWitness, upperBound } from "./complexityBudget";
import { type ComprehensionVerdict } from "./comprehensionGate";

// Maturity/assumption annotations for `npm run assumptions`
// (see docs/architecture/ASSUMPTION_LATTICE.md). SYNTH_ONLY: dev-only HMAC
// signing (A_DEV_HMAC_KEY_CUSTODY is UNMET); assurance rests on the replayable
// compression witness, not the signature.
export const MATURITY = "SYNTH_ONLY" as const;
export const ASSUMPTIONS = [
  "A_SHA256_COLLISION_RESISTANCE",
  "A_DEV_HMAC_KEY_CUSTODY",
] as const;

export const CHAITIN_PROTOCOL = "GHOST-CHAITIN-V1" as const;
/** Dev-only signing key. Local HMAC is development-only (see CLAUDE.md). */
const DEV_HMAC_KEY = "ghost-ark-chaitin-dev-only-hmac-vector-v1";

const sha256hex = (b: Uint8Array | string): string =>
  createHash("sha256").update(b).digest("hex");
const hmacHex = (s: string, key: string): string =>
  createHmac("sha256", key).update(s, "utf8").digest("hex");
const toBytes = (p: Uint8Array | string): Uint8Array =>
  typeof p === "string" ? new TextEncoder().encode(p) : p;

export interface ChaitinReceipt {
  protocol: typeof CHAITIN_PROTOCOL;
  status: ComprehensionVerdict["status"];
  payload_digest: string; // sha256:<hex> over the raw payload bytes
  budget_bytes: number;
  witness: UpperBoundWitness;
  timestamp: string;
  content_digest: string;
  signature: string;
  signing_mode: "dev-hmac";
}

export function buildChaitinReceipt(
  verdict: ComprehensionVerdict,
  payload: Uint8Array | string,
  timestamp: string,
  hmacKey: string = DEV_HMAC_KEY,
): ChaitinReceipt {
  const unsigned = {
    protocol: CHAITIN_PROTOCOL,
    status: verdict.status,
    payload_digest: `sha256:${sha256hex(toBytes(payload))}`,
    budget_bytes: verdict.budget_bytes,
    witness: verdict.witness,
    timestamp,
  };
  const content_digest = `sha256:${sha256hex(danf(unsigned))}`;
  return {
    ...unsigned,
    content_digest,
    signature: hmacHex(content_digest, hmacKey),
    signing_mode: "dev-hmac",
  };
}

export interface ChaitinVerifyResult {
  valid: boolean;
  checks: {
    digest_matches: boolean;
    signature_matches: boolean;
    /** upper_bound_bytes equals the min over the carried measurements. */
    min_correct: boolean;
    /** status agrees with (upper_bound_bytes <= budget_bytes). */
    verdict_consistent: boolean;
    /** null when no payload supplied; otherwise exact recompute agreement. */
    witness_replays: boolean | null;
  };
}

export function verifyChaitinReceipt(
  r: ChaitinReceipt,
  opts: { payload?: Uint8Array | string; hmacKey?: string } = {},
): ChaitinVerifyResult {
  const key = opts.hmacKey ?? DEV_HMAC_KEY;
  const unsigned = {
    protocol: r.protocol,
    status: r.status,
    payload_digest: r.payload_digest,
    budget_bytes: r.budget_bytes,
    witness: r.witness,
    timestamp: r.timestamp,
  };
  const digest_matches = r.content_digest === `sha256:${sha256hex(danf(unsigned))}`;
  const signature_matches = r.signature === hmacHex(r.content_digest, key);
  const min_correct =
    r.witness.measurements.length > 0 &&
    r.witness.upper_bound_bytes ===
      Math.min(...r.witness.measurements.map((m) => m.compressed_bytes));
  const verdict_consistent =
    (r.status === "WITHIN_BUDGET") === (r.witness.upper_bound_bytes <= r.budget_bytes);

  let witness_replays: boolean | null = null;
  if (opts.payload !== undefined) {
    const bytes = toBytes(opts.payload);
    const recomputed = upperBound(bytes);
    witness_replays =
      r.payload_digest === `sha256:${sha256hex(bytes)}` &&
      recomputed.raw_bytes === r.witness.raw_bytes &&
      recomputed.upper_bound_bytes === r.witness.upper_bound_bytes &&
      recomputed.measurements.length === r.witness.measurements.length &&
      recomputed.measurements.every(
        (m, i) =>
          m.algorithm === r.witness.measurements[i].algorithm &&
          m.compressed_bytes === r.witness.measurements[i].compressed_bytes,
      );
  }

  return {
    valid:
      digest_matches &&
      signature_matches &&
      min_correct &&
      verdict_consistent &&
      witness_replays !== false,
    checks: { digest_matches, signature_matches, min_correct, verdict_consistent, witness_replays },
  };
}
