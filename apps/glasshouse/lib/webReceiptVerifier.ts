/**
 * Isomorphic, browser-native Ghost-Ark receipt-record verifier.
 *
 * WHY THIS EXISTS (the "no unproven pixels" contract): a security UI must not
 * render a green "VERIFIED" it cannot itself prove. This module re-derives the
 * verdict from the receipt bytes using the Web Crypto API (`crypto.subtle`),
 * which runs IDENTICALLY in the browser and in Node >= 18 (`globalThis.crypto`).
 * The same file the Mutation Workbench imports is exercised by
 * `tests/differential/webVerifierAgreement.test.ts`, so the engine behind every
 * pixel is CI-covered, not asserted.
 *
 * It is a faithful port of the record-receipt path in
 * `verifiers/node/ghost_receipt_verify.mjs` (canonicalization, receipt
 * identity, digest binding, tenant/key expectation, RSA-PSS/digest-as-message
 * signature). It is NOT compiled to WASM: the Node verifier is JavaScript, so a
 * "WASM verifier" would be an opaque blob where readable, auditable source —
 * inspectable in devtools — is both sufficient and more honest for a glasshouse.
 *
 * CLAIM BOUNDARY. A PASS verdict proves internal receipt consistency under the
 * rules implemented here: the payload canonicalizes to its own identity and
 * digest, and the RSA-PSS signature verifies against the supplied public key.
 * It does NOT prove model safety, semantic truth, compliance, AWS execution,
 * KMS custody, runtime integrity, or resistance to all attacks. The
 * canonicalization is Ghost-Ark canonical JSON; it is NOT claimed to be RFC
 * 8785 / JCS.
 */

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerifyReport {
  verdict: "PASS" | "FAIL";
  checks: CheckResult[];
  limitations: string[];
}

export interface VerifyOptions {
  /** SPKI PEM of the public key; required, or signature verification fails closed. */
  publicKeyPem?: string;
  /** Expected tenant slug; when set, a mismatch fails the tenant check. */
  tenant?: string;
  /** Expected immutable KMS key id (ARN or UUID); when set, a mismatch fails key_id. */
  expectedKeyId?: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const RECORD_RECEIPT_ID = /^rct_[a-f0-9]{64}$/u;
const TENANT_SLUG = /^[a-z][a-z0-9-]{1,47}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const KMS_KEY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_KEY_ARN =
  /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RECORD_ALGORITHM = "RSASSA_PSS_SHA_256";
const RECORD_SCHEMA_VERSION = "ghost-ark.receipt.v1";

const NON_CLAIM =
  "A PASS verdict proves internal receipt consistency under this verifier's documented rules. " +
  "It does not prove model safety, semantic truth, compliance, production readiness, AWS execution, " +
  "KMS custody, runtime integrity, or resistance to all attacks.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ghost-Ark canonical JSON — a byte-for-byte port of `canonicalize` in
 * verifiers/node/ghost_receipt_verify.mjs. Deterministic recursive
 * stable-stringify: lexicographically sorted object keys, rejected
 * undefined/non-finite/sparse/non-plain values. Not RFC 8785.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) {
    throw new TypeError("Canonical JSON cannot encode undefined values.");
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot encode non-finite numbers.");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`Canonical JSON cannot encode sparse arrays (missing index ${index}).`);
      }
      items.push(canonicalize(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts plain objects only.");
    }
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// crypto.subtle wants BufferSource. Our byte helpers produce ArrayBuffer-backed
// Uint8Arrays, but recent TS lib.dom types Uint8Array as generic over
// ArrayBufferLike; this assertion bridges the (sound-here) variance gap.
function src(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Coerce a byte view to BufferSource for crypto.subtle (see `src` note above). */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

/** SHA-256 hex of a UTF-8 string (matches `sha256Hex(canonicalString)` in the Node verifier). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", src(data));
  return bytesToHex(new Uint8Array(digest));
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/u, "")
    .replace(/-----END [^-]+-----/u, "")
    .replace(/\s+/gu, "");
  return base64ToBytes(body);
}

function isImmutableKmsKeyId(keyId: unknown): keyId is string {
  return typeof keyId === "string" && (KMS_KEY_ARN.test(keyId) || KMS_KEY_UUID.test(keyId));
}

function kmsKeyIdsMatch(a: string, b: string): boolean {
  // The Node verifier matches an ARN's trailing key UUID against a bare UUID and
  // vice versa; here we compare case-insensitively on the key UUID suffix.
  const uuidOf = (s: string): string => (s.includes("key/") ? s.slice(s.lastIndexOf("key/") + 4) : s);
  return uuidOf(a).toLowerCase() === uuidOf(b).toLowerCase();
}

/**
 * Verifies the RSA-PSS/SHA-256 signature over the 32-byte digest in
 * `digest-as-message` mode. Web Crypto hashes the message it is given with the
 * key's SHA-256, so passing the raw digest bytes yields EMSA-PSS mHash =
 * SHA-256(digestBytes) — exactly the local-fixture semantics. Salt length 32
 * (= hash length) matches RSASSA_PSS_SHA_256. `digest-as-mhash` (AWS KMS DIGEST
 * semantics) is intentionally unsupported here: `crypto.subtle` cannot skip the
 * message hash, and the local fixtures do not use it.
 */
export async function verifyRsaPssDigestAsMessage(
  publicKeyPem: string,
  digestBytes: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "spki",
    src(pemToDer(publicKeyPem)),
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, src(signature), src(digestBytes));
}

interface ReceiptRecord {
  payload: Record<string, unknown> & { receiptId?: unknown; tenantSlug?: unknown; issuedAt?: unknown; schemaVersion?: unknown };
  signature: Record<string, unknown> & { messageType?: unknown; algorithm?: unknown; digestSha256?: unknown; keyId?: unknown; signatureBase64?: unknown };
}

function validateShape(record: unknown): string | null {
  if (!isRecord(record)) return "Receipt must be a JSON object.";
  const r = record as Partial<ReceiptRecord>;
  if (!isRecord(r.payload)) return "Receipt payload must be an object.";
  if (!isRecord(r.signature)) return "Receipt signature must be an object.";
  const p = r.payload;
  const s = r.signature;
  if (typeof p.receiptId !== "string" || !RECORD_RECEIPT_ID.test(p.receiptId)) return "payload.receiptId must match rct_<64 hex>.";
  if (p.schemaVersion !== RECORD_SCHEMA_VERSION) return `payload.schemaVersion must be ${RECORD_SCHEMA_VERSION}.`;
  if (typeof p.tenantSlug !== "string" || !TENANT_SLUG.test(p.tenantSlug)) return "payload.tenantSlug must be a valid tenant slug.";
  if (typeof p.issuedAt !== "string" || !ISO_UTC.test(p.issuedAt)) return "payload.issuedAt must be a UTC ISO-8601 timestamp.";
  if (s.messageType !== "DIGEST" || s.algorithm !== RECORD_ALGORITHM) return "signature must use messageType DIGEST and RSASSA_PSS_SHA_256.";
  if (typeof s.digestSha256 !== "string" || !SHA256_HEX.test(s.digestSha256)) return "signature.digestSha256 must be a lowercase SHA-256 hex.";
  if (!isImmutableKmsKeyId(s.keyId)) return "signature.keyId must be an immutable KMS key ARN or UUID (aliases are rejected).";
  if (typeof s.signatureBase64 !== "string" || s.signatureBase64.length === 0) return "signature.signatureBase64 is required.";
  return null;
}

/**
 * Independently verifies a Ghost-Ark receipt RECORD. Never throws — every
 * failure is a failed check. Ordering mirrors the Node verifier: schema →
 * tenant → receipt_id → digest → key_id → signature, and signature is skipped
 * (failed closed) if any earlier check fails or no public key is supplied.
 */
export async function verifyReceiptRecordWeb(record: unknown, options: VerifyOptions = {}): Promise<VerifyReport> {
  const checks: CheckResult[] = [];
  const push = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const limitations = [
    "Record verification covers payload identity, digest binding, tenant/key expectations, and RSA-PSS signature validity.",
    "It does not check ledger completeness, AWS execution, KMS custody, or runtime integrity.",
    "RSA-PSS digest treatment: digest-as-message.",
    NON_CLAIM,
  ];

  const shapeError = validateShape(record);
  if (shapeError) {
    push("schema", false, shapeError);
    return { verdict: "FAIL", checks, limitations };
  }
  push("schema", true, "Receipt record matches the supported shape.");
  const r = record as ReceiptRecord;
  const payload = r.payload;
  const signature = r.signature;

  const tenantOk = options.tenant === undefined || payload.tenantSlug === options.tenant;
  push(
    "tenant",
    tenantOk,
    options.tenant === undefined
      ? `No expected tenant supplied; observed ${String(payload.tenantSlug)}.`
      : tenantOk
        ? `tenantSlug matches expected tenant ${options.tenant}.`
        : `tenantSlug ${String(payload.tenantSlug)} does not match expected tenant ${options.tenant}.`,
  );

  const { receiptId: _omit, ...withoutId } = payload;
  const expectedReceiptId = `rct_${await sha256Hex(canonicalize(withoutId))}`;
  const digestSha256 = await sha256Hex(canonicalize(payload));
  push(
    "receipt_id",
    payload.receiptId === expectedReceiptId,
    payload.receiptId === expectedReceiptId
      ? "receiptId recomputes from the canonical identity payload."
      : `receiptId mismatch. Expected ${expectedReceiptId}; observed ${String(payload.receiptId)}.`,
  );
  push(
    "digest",
    signature.digestSha256 === digestSha256,
    signature.digestSha256 === digestSha256
      ? "signature.digestSha256 matches the recomputed canonical payload digest."
      : `digest mismatch. Expected ${digestSha256}; observed ${String(signature.digestSha256)}.`,
  );

  const keyOk =
    options.expectedKeyId === undefined || kmsKeyIdsMatch(String(signature.keyId), options.expectedKeyId);
  push(
    "key_id",
    keyOk,
    keyOk
      ? `keyId ${String(signature.keyId)} satisfies the expected immutable identity.`
      : `keyId mismatch. Expected ${options.expectedKeyId}; observed ${String(signature.keyId)}.`,
  );

  if (!checks.every((c) => c.passed)) {
    push("signature", false, "Signature verification skipped because an earlier check failed (fail closed).");
  } else if (!options.publicKeyPem) {
    push("signature", false, "A public key is required for signature verification. Failing closed.");
  } else {
    try {
      const digestBytes = hexToBytes(digestSha256);
      const ok = await verifyRsaPssDigestAsMessage(options.publicKeyPem, digestBytes, base64ToBytes(String(signature.signatureBase64)));
      push(
        "signature",
        ok,
        ok
          ? "RSA-PSS SHA-256 signature verifies with the supplied public key (digest-as-message)."
          : "RSA-PSS SHA-256 signature does NOT verify with the supplied public key.",
      );
    } catch (e) {
      push("signature", false, `Signature verification errored: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { verdict: checks.every((c) => c.passed) ? "PASS" : "FAIL", checks, limitations };
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
