/**
 * Isomorphic, browser-native verifier for Ghost-Ark DECISION receipts (grct_)
 * and their hash-chains — the runtime-execution counterpart to the record
 * verifier. A faithful port of `verifyDecisionReceipt` + `verifyDecisionReceiptChain`
 * (verifiers/node/ghost_receipt_verify.mjs, packages/enforcement-runtime/src/receipts/chain.ts).
 *
 * THREE SIGNATURE MODES, THREE HONEST VERDICTS — this is the crux the UI must
 * not fudge:
 *   1. LOCAL_HMAC_SHA256_DEV_ONLY — verified in-browser via subtle HMAC using
 *      a PUBLISHED dev test vector. This is a SYMMETRIC shared secret: anyone
 *      holding it can forge. It proves consistency under a dev key, NOT KMS
 *      custody or asymmetric authenticity. Never render it as full "VERIFIED".
 *   2. KMS RSASSA_PSS_SHA_256, digest-as-message — verifiable via subtle
 *      (subtle hashes the 32-byte digest it is given → EMSA-PSS mHash =
 *      SHA-256(digest), the local-fixture semantics). A real PASS.
 *   3. KMS RSASSA_PSS_SHA_256, digest-as-mhash (true AWS KMS DIGEST semantics)
 *      — crypto.subtle CANNOT verify this: it always hashes the message, and
 *      there is no message whose SHA-256 equals a given digest. The Node
 *      verifier uses a hand-rolled RSA-PSS primitive; this browser build does
 *      not ship one, so it returns UNVERIFIABLE (never PASS, never FAIL-as-
 *      tamper). Misreporting either way would be exactly the laundering this
 *      surface exists to prevent.
 *
 * CLAIM BOUNDARY. A PASS proves internal receipt consistency + (for chains)
 * hash-continuity, tenant continuity, and timestamp monotonicity — under this
 * verifier's rules. It does not prove model safety, semantic truth, compliance,
 * completeness of the chain, AWS execution, KMS custody, or runtime integrity.
 */

import {
  canonicalize,
  sha256Hex,
  base64ToBytes,
  hexToBytes,
  asBufferSource,
  verifyRsaPssDigestAsMessage,
  type CheckResult as RecordCheck,
} from "./webReceiptVerifier";

export interface CheckResult extends RecordCheck {
  /** True when the step could not be evaluated in-browser (distinct from a
   *  failed tamper check) — e.g. KMS digest-as-mhash under Web Crypto. */
  unverifiable?: boolean;
}

export type Verdict = "PASS" | "FAIL" | "UNVERIFIABLE";

export interface DecisionReport {
  verdict: Verdict;
  checks: CheckResult[];
  limitations: string[];
  /** Present on success: the recomputed identity + digest, for display. */
  derived?: { receiptId: string; digestSha256: string; signedHash: string };
}

export type PssMode = "digest-as-message" | "digest-as-mhash";

export interface DecisionVerifyOptions {
  /** Dev-only published HMAC test vector; required for LOCAL_HMAC receipts. */
  hmacSecret?: string;
  /** SPKI PEM; required for KMS receipts. */
  publicKeyPem?: string;
  /** How the KMS RSA-PSS signature treats the digest. Defaults to digest-as-message. */
  pssMode?: PssMode;
  /** Expected immutable KMS key id (ARN/UUID) or, for HMAC, the expected key id. */
  expectedKeyId?: string;
  /** Expected tenant_id_hash (the receipt stores a hash, so compare hashes). */
  expectedTenantIdHash?: string;
}

const HMAC_ALG = "LOCAL_HMAC_SHA256_DEV_ONLY";
const KMS_ALG = "KMS_SIGN_RSASSA_PSS_SHA_256";
const DECISION_SCHEMA_VERSION = "ghost.receipt.v1";
const DECISION_RECEIPT_ID = /^grct_[a-f0-9]{64}$/u;
const KMS_KEY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_KEY_ARN =
  /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const REQUIRED_FIELDS = [
  "schema_version", "receipt_id", "request_id", "tenant_id_hash", "user_id_hash",
  "session_id_hash", "timestamp", "model_id", "policy_version", "policy_hash",
  "input_digest", "retrieved_context_digests", "execution_context_hash",
  "execution_nonce", "decision_pre", "decision_post", "action_taken",
  "prev_receipt_hash", "signature_alg", "receipt_signature",
];

const NON_CLAIM =
  "A PASS proves internal receipt consistency (and, for chains, hash/tenant/time continuity) under this " +
  "verifier's rules. It does not prove model safety, semantic truth, compliance, chain completeness, AWS " +
  "execution, KMS custody, or runtime integrity. HMAC verification is dev-only and symmetric.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface Envelope { algorithm: string; keyId: string; digestSha256: string; signature: string; schemaVersion?: string }

function decodeEnvelope(receiptSignature: unknown): Envelope | { err: string } {
  if (typeof receiptSignature !== "string" || receiptSignature.length === 0) return { err: "receipt_signature must be a non-empty base64 string." };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(base64ToBytes(receiptSignature)));
  } catch (e) {
    return { err: `receipt_signature does not decode to JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isRecord(json) || typeof json.algorithm !== "string" || typeof json.keyId !== "string" ||
      typeof json.digestSha256 !== "string" || typeof json.signature !== "string") {
    return { err: "signature envelope is missing required fields." };
  }
  return { algorithm: json.algorithm, keyId: json.keyId, digestSha256: json.digestSha256, signature: json.signature };
}

function validateShape(receipt: unknown): string | null {
  if (!isRecord(receipt)) return "Decision receipt must be a JSON object.";
  const missing = REQUIRED_FIELDS.filter((f) => !Object.prototype.hasOwnProperty.call(receipt, f));
  if (missing.length) return `Missing required field(s): ${missing.join(", ")}.`;
  if (receipt.schema_version !== DECISION_SCHEMA_VERSION) return `schema_version must be ${DECISION_SCHEMA_VERSION}.`;
  if (typeof receipt.receipt_id !== "string" || !DECISION_RECEIPT_ID.test(receipt.receipt_id)) return "receipt_id must match grct_<64 hex>.";
  if (receipt.signature_alg !== HMAC_ALG && receipt.signature_alg !== KMS_ALG) return `unsupported signature_alg ${JSON.stringify(receipt.signature_alg)}.`;
  return null;
}

async function verifyHmac(secret: string, message: string, sig: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", asBufferSource(new TextEncoder().encode(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, asBufferSource(sig), asBufferSource(new TextEncoder().encode(message)));
}

/** `sha256:<hex>` over the canonical FULL signed receipt — the chain-link
 *  preimage (`signedDecisionReceiptHash`). Verified against real fixtures. */
export async function signedDecisionReceiptHashWeb(receipt: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(receipt))}`;
}

/**
 * Verifies a single decision receipt. Never throws. Verdict is UNVERIFIABLE
 * (not FAIL) precisely when the signature cannot be evaluated in-browser
 * (KMS digest-as-mhash) yet everything else holds.
 */
export async function verifyDecisionReceiptWeb(receipt: unknown, options: DecisionVerifyOptions = {}): Promise<DecisionReport> {
  const checks: CheckResult[] = [];
  const push = (name: string, passed: boolean, detail: string, unverifiable = false) => checks.push({ name, passed, detail, unverifiable });
  const limitations = [
    "No key-manifest, checkpoint, attestation, or ledger-completeness checks.",
    "HMAC verification is a dev-only published test vector: symmetric, not KMS custody.",
    NON_CLAIM,
  ];

  const shapeErr = validateShape(receipt);
  if (shapeErr) { push("schema", false, shapeErr); return { verdict: "FAIL", checks, limitations }; }
  push("schema", true, "Matches the strict ghost.receipt.v1 field contract.");
  const r = receipt as Record<string, unknown>;

  const { receipt_signature: _sig, ...unsigned } = r;
  const { receipt_id: _id, ...withoutId } = unsigned;
  let canonicalPayload: string;
  try {
    canonicalPayload = canonicalize(unsigned);
    canonicalize(withoutId);
    push("canonical_payload", true, "Unsigned receipt canonicalization completed.");
  } catch (e) {
    push("canonical_payload", false, e instanceof Error ? e.message : String(e));
    return { verdict: "FAIL", checks, limitations };
  }

  const digestSha256 = await sha256Hex(canonicalPayload);
  const expectId = `grct_${await sha256Hex(canonicalize(withoutId))}`;
  push("receipt_id", r.receipt_id === expectId, r.receipt_id === expectId ? "receipt_id recomputes from the canonical unsigned receipt." : `mismatch — expected ${expectId.slice(0, 22)}…`);

  const env = decodeEnvelope(r.receipt_signature);
  if ("err" in env) {
    push("envelope", false, env.err);
    return { verdict: checks.every((c) => c.passed) ? "PASS" : "FAIL", checks, limitations };
  }
  push("envelope", env.algorithm === r.signature_alg, env.algorithm === r.signature_alg ? "Envelope decodes and its algorithm matches signature_alg." : `envelope algorithm ${env.algorithm} ≠ signature_alg ${String(r.signature_alg)}.`);

  const isKms = r.signature_alg === KMS_ALG;
  let keyOk: boolean, keyDetail: string;
  if (isKms) {
    const immutable = KMS_KEY_ARN.test(env.keyId) || KMS_KEY_UUID.test(env.keyId);
    if (!immutable) { keyOk = false; keyDetail = "KMS keyId must be an immutable ARN or UUID."; }
    else if (options.expectedKeyId && !keysMatch(env.keyId, options.expectedKeyId)) { keyOk = false; keyDetail = "KMS keyId ≠ expected."; }
    else { keyOk = true; keyDetail = `KMS keyId ${env.keyId.slice(0, 28)}… is immutable.`; }
  } else {
    keyOk = options.expectedKeyId ? env.keyId === options.expectedKeyId : env.keyId.length > 0;
    keyDetail = keyOk ? `keyId ${env.keyId} present.` : `keyId ${env.keyId} ≠ expected.`;
  }
  push("key_id", keyOk, keyDetail);
  push("digest", env.digestSha256 === digestSha256, env.digestSha256 === digestSha256 ? "Envelope digest equals the recomputed canonical payload digest." : `digest mismatch — recomputed ${digestSha256.slice(0, 16)}…`);

  // Signature — the tri-modal, tri-verdict step.
  if (!checks.every((c) => c.passed)) {
    push("signature", false, "Skipped — an earlier check failed (fail closed).");
  } else if (r.signature_alg === HMAC_ALG) {
    if (!options.hmacSecret) push("signature", false, "Dev-only HMAC requires the published test vector (hmacSecret). Failing closed.");
    else {
      const ok = await verifyHmac(options.hmacSecret, canonicalPayload, base64ToBytes(env.signature));
      push("signature", ok, ok ? "DEV-ONLY HMAC verifies over the canonical unsigned receipt (symmetric — not KMS custody)." : "Dev-only HMAC does NOT verify.");
    }
  } else {
    // KMS RSA-PSS.
    if (!options.publicKeyPem) push("signature", false, "KMS receipt requires a public key. Failing closed.");
    else if ((options.pssMode ?? "digest-as-message") === "digest-as-mhash") {
      push("signature", false, "KMS DIGEST mode (digest-as-mhash) cannot be verified by Web Crypto — subtle always hashes the message. Requires a raw RSA-PSS primitive (present in the Node verifier, not this browser build).", true);
    } else {
      try {
        const ok = await verifyRsaPssDigestAsMessage(options.publicKeyPem, hexToBytes(digestSha256), base64ToBytes(env.signature));
        if (ok) push("signature", true, "KMS RSA-PSS (digest-as-message) verifies with the supplied public key.");
        else push("signature", false, "RSA-PSS (digest-as-message) does not verify — tampering, OR a digest-as-mhash signature this build cannot check.", true);
      } catch (e) { push("signature", false, `signature errored: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  // Tenant expectation (consumer boundary).
  if (options.expectedTenantIdHash !== undefined) {
    const tOk = r.tenant_id_hash === options.expectedTenantIdHash;
    push("tenant", tOk, tOk ? "tenant_id_hash matches the expected tenant." : "tenant_id_hash ≠ expected tenant.");
  }

  const signedHash = await signedDecisionReceiptHashWeb(receipt);
  const anyFail = checks.some((c) => !c.passed && !c.unverifiable);
  const anyUnverifiable = checks.some((c) => c.unverifiable);
  const verdict: Verdict = anyFail ? "FAIL" : anyUnverifiable ? "UNVERIFIABLE" : "PASS";
  return { verdict, checks, limitations, derived: { receiptId: expectId, digestSha256, signedHash } };
}

function keysMatch(a: string, b: string): boolean {
  const u = (s: string) => (s.includes("key/") ? s.slice(s.lastIndexOf("key/") + 4) : s);
  return u(a).toLowerCase() === u(b).toLowerCase();
}

export interface ChainLink { index: number; passed: boolean; detail: string }

/**
 * Verifies a decision-receipt chain: schema per node, single-tenant continuity,
 * no duplicate signed hashes, head has no prev hash, timestamps non-decreasing,
 * and each `prev_receipt_hash` equals the prior receipt's signed hash. A port of
 * `verifyDecisionReceiptChain`. This checks LINKAGE only — it does not verify
 * each receipt's signature (call verifyDecisionReceiptWeb for that).
 */
export async function verifyDecisionChainWeb(receipts: unknown[]): Promise<ChainLink[]> {
  if (!Array.isArray(receipts) || receipts.length === 0) return [{ index: -1, passed: false, detail: "Chain must be a non-empty array." }];
  const firstTenant = isRecord(receipts[0]) ? receipts[0].tenant_id_hash : undefined;
  const seen = new Set<string>();
  const out: ChainLink[] = [];
  for (let i = 0; i < receipts.length; i += 1) {
    const receipt = receipts[i];
    const shapeErr = validateShape(receipt);
    if (shapeErr || !isRecord(receipt)) { out.push({ index: i, passed: false, detail: `schema invalid: ${shapeErr ?? "not an object"}` }); continue; }
    if (firstTenant && receipt.tenant_id_hash !== firstTenant) { out.push({ index: i, passed: false, detail: "tenant-chain break — different tenant_id_hash." }); continue; }
    const currentHash = await signedDecisionReceiptHashWeb(receipt);
    if (seen.has(currentHash)) { out.push({ index: i, passed: false, detail: "duplicate signed receipt hash." }); continue; }
    seen.add(currentHash);
    if (i === 0) { out.push({ index: i, passed: receipt.prev_receipt_hash === null, detail: receipt.prev_receipt_hash === null ? "head receipt has no previous hash." : "head unexpectedly declares a previous hash." }); continue; }
    const prev = receipts[i - 1];
    if (!isRecord(prev)) { out.push({ index: i, passed: false, detail: "prior receipt invalid." }); continue; }
    if (Date.parse(String(receipt.timestamp)) < Date.parse(String(prev.timestamp))) { out.push({ index: i, passed: false, detail: "timestamp earlier than prior receipt." }); continue; }
    const expected = await signedDecisionReceiptHashWeb(prev);
    out.push({ index: i, passed: receipt.prev_receipt_hash === expected, detail: receipt.prev_receipt_hash === expected ? "prev_receipt_hash matches the prior signed receipt." : `hash-chain break — expected ${expected.slice(0, 24)}…` });
  }
  return out;
}
