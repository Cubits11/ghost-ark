// Evidence-over-proof receipts for Löbian licensing refutations.
//
// When the GL engine refutes a licensing obligation, Ghost-Ark does not crash
// and does not pretend the successor is safe: it emits a canonical, hashed,
// signed receipt carrying the finite Kripke COUNTERMODEL as its witness. The
// verifier re-runs the independent model checker on that countermodel, so the
// receipt is replayable evidence of *why the proof fails*, not an endorsement.
//
// A receipt certifies exactly: "boundary code (this GL decision procedure)
// reached this verdict on this obligation, and here is the witness." It does
// NOT certify that any agent is safe, aligned, or semantically correct.

import { createHash, createHmac } from "node:crypto";
import { type Formula, show } from "./formula";
import { type KripkeModel, canonicalModel, isGLFrame, refutes } from "./kripke";
import { decide } from "./glTableau";
import { type Verdict } from "./lobianObstacle";

// Maturity/assumption annotations for `npm run assumptions`
// (see docs/architecture/ASSUMPTION_LATTICE.md). SYNTH_ONLY: the signature is a
// dev-only HMAC (A_DEV_HMAC_KEY_CUSTODY is UNMET). The receipt's assurance does
// not rest on that signature but on the REPLAYABLE evidence (verifyReceipt
// re-runs the model checker on the carried countermodel).
export const MATURITY = "SYNTH_ONLY" as const;
export const ASSUMPTIONS = [
  "A_SHA256_COLLISION_RESISTANCE",
  "A_DEV_HMAC_KEY_CUSTODY",
] as const;

export const PROTOCOL = "GHOST-LOBIAN-V1" as const;
/** Dev-only signing key. Local HMAC is development-only (see CLAUDE.md). */
const DEV_HMAC_KEY = "ghost-ark-lobian-dev-only-hmac-vector-v1";

export interface LobianReceipt {
  protocol: typeof PROTOCOL;
  status: "LICENSE_CERTIFIED" | "LICENSE_REFUTED";
  obligation_kind: string;
  invariant: string;
  /** The obligation formula as replayable AST (Formula is plain JSON data). */
  obligation: Formula;
  agent_digest: string;
  evidence:
    | { kind: "proof"; proof_digest: string }
    | { kind: "countermodel"; model: ReturnType<typeof canonicalModel>; root: string };
  timestamp: string;
  content_digest: string;
  signature: string;
  signing_mode: "dev-hmac";
}

/**
 * Local deterministic normal form for the research receipt. Recursively sorts
 * object keys and rejects non-JSON host values before hashing — the same
 * "reject, don't coerce" discipline as the production canonicalizer, kept
 * separate so this research module never touches the guarded core.
 */
export function danf(value: unknown): string {
  const enc = (v: unknown): unknown => {
    if (v === null) return null;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("DANF: non-finite number");
      return v;
    }
    if (typeof v === "string" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(enc);
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = enc(o[k]);
      return out;
    }
    throw new Error(`DANF: non-JSON value of type ${typeof v}`);
  };
  return JSON.stringify(enc(value));
}

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (s: string, key: string): string =>
  createHmac("sha256", key).update(s, "utf8").digest("hex");

/** sha256 over the canonical descriptor of the successor agent being licensed. */
export function agentDigest(descriptor: unknown): string {
  return `sha256:${sha256(danf(descriptor))}`;
}

/** Build a signed receipt from a verdict. `timestamp` is caller-supplied (kept
 *  out of the engine so runs are deterministic and reproducible). */
export function buildReceipt(
  verdict: Verdict,
  agent_digest: string,
  timestamp: string,
  hmacKey: string = DEV_HMAC_KEY,
): LobianReceipt {
  const evidence: LobianReceipt["evidence"] =
    verdict.status === "LICENSE_CERTIFIED"
      ? { kind: "proof", proof_digest: `sha256:${sha256(danf(verdict.proof))}` }
      : { kind: "countermodel", model: canonicalModel(verdict.countermodel), root: verdict.root };

  const unsigned = {
    protocol: PROTOCOL,
    status: verdict.status,
    obligation_kind: verdict.obligation.kind,
    invariant: show(verdict.obligation.invariant),
    obligation: verdict.obligation.formula,
    agent_digest,
    evidence,
    timestamp,
  };
  const content_digest = `sha256:${sha256(danf(unsigned))}`;
  return {
    ...unsigned,
    content_digest,
    signature: hmac(content_digest, hmacKey),
    signing_mode: "dev-hmac",
  };
}

export interface VerifyResult {
  valid: boolean;
  checks: {
    digest_matches: boolean;
    signature_matches: boolean;
    /** For REFUTED: the embedded countermodel is a GL frame that refutes φ.
     *  For CERTIFIED: re-deciding φ reproduces the theorem verdict. */
    evidence_replays: boolean;
  };
}

/**
 * Independently verify a receipt: recompute the digest and signature, AND replay
 * the evidence. For a refutation, that means re-running the model checker on the
 * carried countermodel; for a certification, re-deciding the obligation. A
 * receipt whose evidence does not replay is invalid regardless of its signature.
 */
export function verifyReceipt(r: LobianReceipt, hmacKey: string = DEV_HMAC_KEY): VerifyResult {
  const { content_digest, signature, ...rest } = r;
  const unsigned = {
    protocol: rest.protocol,
    status: rest.status,
    obligation_kind: rest.obligation_kind,
    invariant: rest.invariant,
    obligation: rest.obligation,
    agent_digest: rest.agent_digest,
    evidence: rest.evidence,
    timestamp: rest.timestamp,
  };
  const digest_matches = content_digest === `sha256:${sha256(danf(unsigned))}`;
  const signature_matches = signature === hmac(content_digest, hmacKey);

  let evidence_replays = false;
  if (r.status === "LICENSE_REFUTED" && r.evidence.kind === "countermodel") {
    const m: KripkeModel = r.evidence.model;
    evidence_replays = isGLFrame(m) && refutes(m, r.evidence.root, r.obligation);
  } else if (r.status === "LICENSE_CERTIFIED") {
    evidence_replays = decide(r.obligation).theorem === true;
  }

  return {
    valid: digest_matches && signature_matches && evidence_replays,
    checks: { digest_matches, signature_matches, evidence_replays },
  };
}
