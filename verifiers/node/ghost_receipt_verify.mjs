#!/usr/bin/env node

/**
 * Standalone Ghost-Ark receipt verifier.
 *
 * Independence boundary:
 * - imports Node.js built-ins only;
 * - does not import the receipt emitter, production verifier, schemas, or any
 *   other Ghost-Ark package;
 * - performs no AWS calls and reads no credentials;
 * - implements canonicalization, strict receipt/envelope validation, receipt
 *   identity, digest binding, tenant expectation, key identity, dev-only HMAC,
 *   and RSA-PSS verification in this file.
 *
 * A PASS verdict establishes consistency only under the rules implemented
 * here. It is not evidence of model safety, semantic truth, compliance, AWS
 * execution, KMS custody, runtime integrity, or complete attack coverage.
 */

import { createHash, createHmac, createPublicKey, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPORT_SCHEMA_VERSION = "ghost.node_independent_verifier_report.v1";
export const DECISION_SCHEMA_VERSION = "ghost.receipt.v1";
export const RECORD_SCHEMA_VERSION = "ghost-ark.receipt.v1";
export const ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1";

const HMAC_ALGORITHM = "LOCAL_HMAC_SHA256_DEV_ONLY";
const KMS_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256";
const RECORD_ALGORITHM = "RSASSA_PSS_SHA_256";
const PSS_MODE_MESSAGE = "digest-as-message";
const PSS_MODE_MHASH = "digest-as-mhash";

const NON_CLAIM =
  "A PASS verdict proves internal receipt consistency under this standalone verifier's documented rules. " +
  "It does not prove model safety, semantic truth, compliance, production readiness, AWS execution, KMS custody, " +
  "runtime integrity, or resistance to all attacks.";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const DIGEST_PATTERN = /^(?:sha256|hmac-sha256):[a-f0-9]{64}$/u;
const RECEIPT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DECISION_RECEIPT_ID_PATTERN = /^grct_[a-f0-9]{64}$/u;
const RECORD_RECEIPT_ID_PATTERN = /^rct_[a-f0-9]{64}$/u;
const EXECUTION_NONCE_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/u;
const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,47}$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const STANDARD_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const KMS_KEY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_KEY_ARN_PATTERN =
  /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const DECISION_REQUIRED_FIELDS = [
  "schema_version",
  "receipt_id",
  "request_id",
  "tenant_id_hash",
  "user_id_hash",
  "session_id_hash",
  "timestamp",
  "model_id",
  "policy_version",
  "policy_hash",
  "input_digest",
  "execution_context_hash",
  "execution_nonce",
  "decision_pre",
  "decision_post",
  "risk_score",
  "consent_state",
  "memory_written",
  "latency_ms",
  "cost_estimate_usd",
  "signature_alg"
];

const DECISION_DEFAULTS = Object.freeze({
  retrieved_context_digests: Object.freeze([]),
  action_taken: Object.freeze([]),
  prev_receipt_hash: null
});

const DECISION_ALL_FIELDS = new Set([
  ...DECISION_REQUIRED_FIELDS,
  ...Object.keys(DECISION_DEFAULTS),
  "receipt_signature"
]);

const DECISION_KINDS = new Set(["ALLOW", "ALLOW_WITH_CONSTRAINTS", "REDACT", "REFUSE", "ESCALATE"]);
const CONSENT_STATES = new Set(["granted", "denied", "missing", "not_required"]);
const SIGNATURE_ALGORITHMS = new Set([HMAC_ALGORITHM, KMS_ALGORITHM]);
const PSS_MODES = new Set([PSS_MODE_MESSAGE, PSS_MODE_MHASH]);
const ENVELOPE_FIELDS = ["algorithm", "digestSha256", "keyId", "schemaVersion", "signature"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Ghost-Ark canonical JSON, independently implemented from its documented
 * contract. Object keys use ECMAScript UTF-16 lexicographic ordering.
 */
export function canonicalize(value) {
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
    const items = [];
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

function isIsoUtcTimestamp(value) {
  return typeof value === "string" && ISO_UTC_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function validateDecisionReceipt(value) {
  if (!isRecord(value)) {
    return { error: "Receipt must be a JSON object." };
  }
  if (value.schema_version !== DECISION_SCHEMA_VERSION) {
    return {
      error: `Unsupported schema_version ${JSON.stringify(value.schema_version)}. Expected ${DECISION_SCHEMA_VERSION}.`
    };
  }

  const unknown = Object.keys(value).filter((field) => !DECISION_ALL_FIELDS.has(field)).sort();
  if (unknown.length > 0) {
    return { error: `Receipt contains unknown fields: ${unknown.join(", ")}.` };
  }

  const missing = DECISION_REQUIRED_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (!Object.prototype.hasOwnProperty.call(value, "receipt_signature")) {
    missing.push("receipt_signature");
  }
  if (missing.length > 0) {
    return { error: `Receipt is missing required fields: ${missing.join(", ")}.` };
  }

  const filled = { ...value };
  for (const [field, defaultValue] of Object.entries(DECISION_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(filled, field)) {
      filled[field] = cloneJson(defaultValue);
    }
  }

  if (typeof filled.receipt_id !== "string" || !DECISION_RECEIPT_ID_PATTERN.test(filled.receipt_id)) {
    return { error: "receipt_id must match grct_<64 lowercase hex>." };
  }
  for (const field of ["tenant_id_hash", "user_id_hash", "session_id_hash", "input_digest", "execution_context_hash"]) {
    if (typeof filled[field] !== "string" || !DIGEST_PATTERN.test(filled[field])) {
      return { error: `${field} must be a sha256: or hmac-sha256: digest.` };
    }
  }
  if (typeof filled.policy_hash !== "string" || !SHA256_HEX_PATTERN.test(filled.policy_hash)) {
    return { error: "policy_hash must be 64 lowercase hexadecimal characters." };
  }
  if (typeof filled.execution_nonce !== "string" || !EXECUTION_NONCE_PATTERN.test(filled.execution_nonce)) {
    return { error: "execution_nonce must be 8-256 characters of accepted URL-safe text." };
  }
  for (const field of ["request_id", "model_id", "policy_version"]) {
    if (typeof filled[field] !== "string" || filled[field].length === 0) {
      return { error: `${field} must be a non-empty string.` };
    }
  }
  if (!isIsoUtcTimestamp(filled.timestamp)) {
    return { error: "timestamp must be a valid UTC ISO-8601 date-time." };
  }
  if (!DECISION_KINDS.has(filled.decision_pre) || !DECISION_KINDS.has(filled.decision_post)) {
    return { error: "decision_pre and decision_post must be supported decision kinds." };
  }
  if (!CONSENT_STATES.has(filled.consent_state)) {
    return { error: "consent_state must be a supported consent state." };
  }
  if (typeof filled.memory_written !== "boolean") {
    return { error: "memory_written must be a boolean." };
  }
  if (
    !Array.isArray(filled.retrieved_context_digests) ||
    !filled.retrieved_context_digests.every((entry) => typeof entry === "string" && DIGEST_PATTERN.test(entry))
  ) {
    return { error: "retrieved_context_digests must be an array of digest strings." };
  }
  if (
    !Array.isArray(filled.action_taken) ||
    !filled.action_taken.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    return { error: "action_taken must be an array of non-empty strings." };
  }
  if (
    filled.prev_receipt_hash !== null &&
    (typeof filled.prev_receipt_hash !== "string" || !RECEIPT_HASH_PATTERN.test(filled.prev_receipt_hash))
  ) {
    return { error: "prev_receipt_hash must be null or a sha256: digest." };
  }
  if (typeof filled.risk_score !== "number" || !Number.isFinite(filled.risk_score) || filled.risk_score < 0 || filled.risk_score > 1) {
    return { error: "risk_score must be a finite number from 0 through 1." };
  }
  if (!Number.isSafeInteger(filled.latency_ms) || filled.latency_ms < 0) {
    return { error: "latency_ms must be a non-negative safe integer." };
  }
  if (typeof filled.cost_estimate_usd !== "number" || !Number.isFinite(filled.cost_estimate_usd) || filled.cost_estimate_usd < 0) {
    return { error: "cost_estimate_usd must be a non-negative finite number." };
  }
  if (!SIGNATURE_ALGORITHMS.has(filled.signature_alg)) {
    return { error: `Unsupported signature_alg ${JSON.stringify(filled.signature_alg)}.` };
  }
  if (typeof filled.receipt_signature !== "string" || filled.receipt_signature.length === 0) {
    return { error: "receipt_signature must be a non-empty string." };
  }

  return { receipt: filled };
}

function decodeStrictBase64(value) {
  if (typeof value !== "string" || value.length === 0 || !STANDARD_BASE64_PATTERN.test(value)) {
    throw new TypeError("signature must be non-empty canonical standard base64 text.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new TypeError("signature must decode canonically to non-empty bytes.");
  }
  return decoded;
}

function decodeDecisionEnvelope(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0 || !BASE64URL_PATTERN.test(encoded) || encoded.length % 4 === 1) {
    throw new TypeError("receipt_signature must be unpadded base64url text.");
  }
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) {
    throw new TypeError("receipt_signature must use canonical unpadded base64url encoding.");
  }

  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("receipt_signature must decode to UTF-8 JSON.");
  }

  let envelope;
  try {
    envelope = JSON.parse(decoded);
  } catch {
    throw new TypeError("receipt_signature must be a base64url-encoded JSON signature envelope.");
  }
  if (!isRecord(envelope)) {
    throw new TypeError("receipt_signature envelope must decode to an object.");
  }

  const observedFields = Object.keys(envelope).sort();
  if (
    observedFields.length !== ENVELOPE_FIELDS.length ||
    observedFields.some((field, index) => field !== ENVELOPE_FIELDS[index])
  ) {
    throw new TypeError("receipt_signature envelope contains an unexpected field set.");
  }
  if (envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION) {
    throw new TypeError("receipt_signature envelope has an unsupported schemaVersion.");
  }
  if (!SIGNATURE_ALGORITHMS.has(envelope.algorithm)) {
    throw new TypeError("receipt_signature envelope has an unsupported algorithm.");
  }
  if (typeof envelope.keyId !== "string" || envelope.keyId.length === 0) {
    throw new TypeError("receipt_signature envelope keyId must be non-empty.");
  }
  if (typeof envelope.digestSha256 !== "string" || !SHA256_HEX_PATTERN.test(envelope.digestSha256)) {
    throw new TypeError("receipt_signature envelope digestSha256 must be a lowercase SHA-256 hex digest.");
  }
  decodeStrictBase64(envelope.signature);
  if (canonicalize(envelope) !== decoded) {
    throw new TypeError("receipt_signature envelope JSON must use the canonical field order and encoding.");
  }

  return envelope;
}

function isImmutableKmsKeyId(value) {
  return typeof value === "string" && (KMS_KEY_UUID_PATTERN.test(value) || KMS_KEY_ARN_PATTERN.test(value));
}

function kmsKeyUuid(value) {
  return value.includes(":key/") ? value.slice(value.lastIndexOf("/") + 1) : value;
}

function immutableKmsKeyIdsMatch(left, right) {
  if (!isImmutableKmsKeyId(left) || !isImmutableKmsKeyId(right)) {
    return false;
  }
  if (KMS_KEY_ARN_PATTERN.test(left) && KMS_KEY_ARN_PATTERN.test(right)) {
    return left === right;
  }
  return kmsKeyUuid(left) === kmsKeyUuid(right);
}

function fixedLengthBuffer(value, length) {
  const hex = value.toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) {
    throw new RangeError("Integer does not fit the requested output length.");
  }
  return Buffer.from(hex, "hex");
}

function bufferToBigInt(value) {
  const hex = Buffer.from(value).toString("hex");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

function bitLength(value) {
  return value === 0n ? 0 : value.toString(2).length;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) {
      result = (result * factor) % modulus;
    }
    remaining >>= 1n;
    factor = (factor * factor) % modulus;
  }
  return result;
}

function mgf1Sha256(seed, length) {
  const blocks = [];
  for (let counter = 0; Buffer.concat(blocks).length < length; counter += 1) {
    const encodedCounter = Buffer.alloc(4);
    encodedCounter.writeUInt32BE(counter);
    blocks.push(createHash("sha256").update(seed).update(encodedCounter).digest());
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function emsaPssVerifySha256(messageHash, encodedMessage, encodedBits, saltLength = 32) {
  const hashLength = 32;
  const encodedLength = Math.ceil(encodedBits / 8);
  if (messageHash.length !== hashLength || encodedMessage.length !== encodedLength) {
    return false;
  }
  if (encodedLength < hashLength + saltLength + 2 || encodedMessage.at(-1) !== 0xbc) {
    return false;
  }

  const maskedDb = encodedMessage.subarray(0, encodedLength - hashLength - 1);
  const observedHash = encodedMessage.subarray(encodedLength - hashLength - 1, encodedLength - 1);
  const unusedBits = encodedLength * 8 - encodedBits;
  if (unusedBits > 0 && maskedDb[0] >> (8 - unusedBits) !== 0) {
    return false;
  }

  const dbMask = mgf1Sha256(observedHash, maskedDb.length);
  const db = Buffer.alloc(maskedDb.length);
  for (let index = 0; index < maskedDb.length; index += 1) {
    db[index] = maskedDb[index] ^ dbMask[index];
  }
  if (unusedBits > 0) {
    db[0] &= 0xff >> unusedBits;
  }

  const paddingLength = encodedLength - hashLength - saltLength - 2;
  for (let index = 0; index < paddingLength; index += 1) {
    if (db[index] !== 0) {
      return false;
    }
  }
  if (db[paddingLength] !== 0x01) {
    return false;
  }

  const salt = db.subarray(paddingLength + 1);
  const recomputedHash = createHash("sha256")
    .update(Buffer.alloc(8))
    .update(messageHash)
    .update(salt)
    .digest();
  return timingSafeEqual(recomputedHash, observedHash);
}

function parseRsaPublicKey(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "rsa" && key.asymmetricKeyType !== "rsa-pss") {
    throw new TypeError(`Expected an RSA public key; observed ${key.asymmetricKeyType ?? "unknown"}.`);
  }
  const jwk = key.export({ format: "jwk" });
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new TypeError("RSA public key export did not contain modulus and exponent values.");
  }
  const modulus = bufferToBigInt(Buffer.from(jwk.n, "base64url"));
  const exponent = bufferToBigInt(Buffer.from(jwk.e, "base64url"));
  const modulusBits = bitLength(modulus);
  if (modulusBits < 2048 || modulusBits > 8192 || exponent < 3n || exponent % 2n === 0n) {
    throw new TypeError("RSA public key parameters are outside the accepted verifier bounds.");
  }
  return { modulus, exponent, modulusBits };
}

function verifyRsaPssDigest(publicKeyPem, digest, signature, pssMode) {
  const { modulus, exponent, modulusBits } = parseRsaPublicKey(publicKeyPem);
  const modulusLength = Math.ceil(modulusBits / 8);
  if (signature.length !== modulusLength) {
    return false;
  }
  const signatureInteger = bufferToBigInt(signature);
  if (signatureInteger >= modulus) {
    return false;
  }
  const encodedBits = modulusBits - 1;
  const encodedLength = Math.ceil(encodedBits / 8);
  const encodedMessage = fixedLengthBuffer(modPow(signatureInteger, exponent, modulus), encodedLength);
  const messageHash =
    pssMode === PSS_MODE_MHASH ? Buffer.from(digest) : createHash("sha256").update(digest).digest();
  return emsaPssVerifySha256(messageHash, encodedMessage, encodedBits);
}

function constantTimeTextEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function tenantExpectationCheck(observedTenantHash, options) {
  if (options.expectedTenantIdHash === undefined && options.tenant === undefined) {
    return null;
  }
  let expected = options.expectedTenantIdHash;
  if (expected === undefined) {
    if (!options.identityHmacSecret) {
      return check(
        "tenant_expectation",
        false,
        "A decision-receipt tenant expectation requires --identity-hmac-secret or --expected-tenant-id-hash."
      );
    }
    expected = `hmac-sha256:${createHmac("sha256", options.identityHmacSecret).update(options.tenant).digest("hex")}`;
  }
  const passed = typeof expected === "string" && DIGEST_PATTERN.test(expected) && constantTimeTextEqual(expected, observedTenantHash);
  return check(
    "tenant_expectation",
    passed,
    passed
      ? "Receipt tenant_id_hash matches the expected tenant commitment."
      : "Receipt tenant_id_hash does not match the expected tenant commitment."
  );
}

function buildReport(checks, limitations, options, recomputed) {
  const report = {
    schema_version: REPORT_SCHEMA_VERSION,
    verifier: "verifiers/node/ghost_receipt_verify.mjs",
    verdict: checks.length > 0 && checks.every((entry) => entry.passed) ? "PASS" : "FAIL",
    checks,
    limitations,
    pss_mode: options.pssMode,
    non_claim: NON_CLAIM
  };
  if (recomputed) {
    report.recomputed = recomputed;
  }
  return report;
}

export function verifyDecisionReceipt(receipt, options = {}) {
  const normalizedOptions = {
    expectedKeyId: options.expectedKeyId,
    hmacSecret: options.hmacSecret,
    publicKeyPem: options.publicKeyPem,
    tenant: options.tenant,
    identityHmacSecret: options.identityHmacSecret,
    expectedTenantIdHash: options.expectedTenantIdHash,
    pssMode: options.pssMode ?? PSS_MODE_MESSAGE
  };
  const checks = [];
  const limitations = [
    "No key-manifest, chain, checkpoint, attestation, or ledger-completeness checks.",
    "Dev-only HMAC verification requires an explicitly supplied published test vector.",
    "RSA-PSS verification establishes public-key/signature consistency, not AWS KMS custody or provenance.",
    `RSA-PSS digest treatment: ${normalizedOptions.pssMode}.`
  ];

  if (!PSS_MODES.has(normalizedOptions.pssMode)) {
    checks.push(check("configuration", false, `Unsupported RSA-PSS digest treatment ${JSON.stringify(normalizedOptions.pssMode)}.`));
    return buildReport(checks, limitations, normalizedOptions);
  }

  const schema = validateDecisionReceipt(receipt);
  if (!schema.receipt) {
    checks.push(check("schema", false, schema.error));
    return buildReport(checks, limitations, normalizedOptions);
  }
  const filled = schema.receipt;
  checks.push(check("schema", true, "Receipt matches the strict ghost.receipt.v1 field contract."));

  const { receipt_signature: _signatureEnvelope, ...unsigned } = filled;
  const { receipt_id: _receiptId, ...withoutId } = unsigned;
  let canonicalPayload;
  let canonicalIdentity;
  try {
    canonicalPayload = canonicalize(unsigned);
    canonicalIdentity = canonicalize(withoutId);
    checks.push(check("canonical_payload", true, "Unsigned receipt canonicalization completed."));
  } catch (error) {
    checks.push(check("canonical_payload", false, error instanceof Error ? error.message : String(error)));
    return buildReport(checks, limitations, normalizedOptions);
  }

  const digestSha256 = sha256Hex(canonicalPayload);
  const receiptId = `grct_${sha256Hex(canonicalIdentity)}`;
  checks.push(
    check(
      "receipt_id",
      receiptId === filled.receipt_id,
      receiptId === filled.receipt_id
        ? "receipt_id recomputes from the canonical unsigned receipt."
        : `Receipt id mismatch. Expected ${receiptId}; observed ${filled.receipt_id}.`
    )
  );

  let envelope;
  try {
    envelope = decodeDecisionEnvelope(filled.receipt_signature);
    if (envelope.algorithm !== filled.signature_alg) {
      checks.push(
        check(
          "envelope",
          false,
          `Envelope algorithm ${envelope.algorithm} does not match receipt signature_alg ${filled.signature_alg}.`
        )
      );
    } else {
      checks.push(check("envelope", true, "Signature envelope decodes strictly and matches receipt signature_alg."));
    }
  } catch (error) {
    checks.push(check("envelope", false, error instanceof Error ? error.message : String(error)));
  }

  if (!envelope) {
    checks.push(check("signature", false, "Signature verification skipped because envelope decoding failed."));
    const tenantCheck = tenantExpectationCheck(filled.tenant_id_hash, normalizedOptions);
    if (tenantCheck) {
      checks.push(tenantCheck);
    }
    return buildReport(checks, limitations, normalizedOptions, {
      receipt_id: receiptId,
      digest_sha256: digestSha256,
      canonical_payload_sha256: digestSha256
    });
  }

  let keyIdPassed;
  let keyIdDetail;
  if (filled.signature_alg === KMS_ALGORITHM) {
    if (!isImmutableKmsKeyId(envelope.keyId)) {
      keyIdPassed = false;
      keyIdDetail = "Signature keyId must be an immutable KMS key ARN or key UUID.";
    } else if (normalizedOptions.expectedKeyId && !immutableKmsKeyIdsMatch(envelope.keyId, normalizedOptions.expectedKeyId)) {
      keyIdPassed = false;
      keyIdDetail = `Signature keyId mismatch. Expected ${normalizedOptions.expectedKeyId}; observed ${envelope.keyId}.`;
    } else {
      keyIdPassed = true;
      keyIdDetail = `Signature keyId ${envelope.keyId} is an immutable KMS key identity.`;
    }
  } else if (normalizedOptions.expectedKeyId && envelope.keyId !== normalizedOptions.expectedKeyId) {
    keyIdPassed = false;
    keyIdDetail = `Signature keyId mismatch. Expected ${normalizedOptions.expectedKeyId}; observed ${envelope.keyId}.`;
  } else {
    keyIdPassed = envelope.keyId.length > 0;
    keyIdDetail = `Signature keyId ${envelope.keyId} is present.`;
  }
  checks.push(check("key_id", keyIdPassed, keyIdDetail));

  checks.push(
    check(
      "digest",
      envelope.digestSha256 === digestSha256,
      envelope.digestSha256 === digestSha256
        ? "Envelope digestSha256 equals the recomputed canonical unsigned receipt digest."
        : `Digest mismatch. Expected ${digestSha256}; observed ${envelope.digestSha256}.`
    )
  );

  if (!checks.every((entry) => entry.passed)) {
    checks.push(check("signature", false, "Signature verification skipped because an earlier receipt check failed."));
  } else if (filled.signature_alg === HMAC_ALGORITHM) {
    if (!normalizedOptions.hmacSecret) {
      checks.push(check("signature", false, "Pass the published dev-only test vector with --hmac-secret. Failing closed."));
    } else {
      const expected = createHmac("sha256", normalizedOptions.hmacSecret).update(canonicalPayload).digest();
      const observed = decodeStrictBase64(envelope.signature);
      const passed = expected.length === observed.length && timingSafeEqual(expected, observed);
      checks.push(
        check(
          "signature",
          passed,
          passed
            ? "Dev-only HMAC signature verifies over the canonical unsigned receipt."
            : "Dev-only HMAC signature does not verify over the canonical unsigned receipt."
        )
      );
    }
  } else if (!normalizedOptions.publicKeyPem) {
    checks.push(check("signature", false, "A public key is required for KMS-algorithm receipt verification. Failing closed."));
  } else {
    let passed = false;
    let detail;
    try {
      passed = verifyRsaPssDigest(
        normalizedOptions.publicKeyPem,
        Buffer.from(digestSha256, "hex"),
        decodeStrictBase64(envelope.signature),
        normalizedOptions.pssMode
      );
      detail = passed
        ? `RSA-PSS SHA-256 signature verifies with the supplied public key (${normalizedOptions.pssMode}).`
        : `RSA-PSS SHA-256 signature does not verify with the supplied public key (${normalizedOptions.pssMode}).`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    checks.push(check("signature", passed, detail));
  }

  const tenantCheck = tenantExpectationCheck(filled.tenant_id_hash, normalizedOptions);
  if (tenantCheck) {
    checks.push(tenantCheck);
  }

  return buildReport(checks, limitations, normalizedOptions, {
    receipt_id: receiptId,
    digest_sha256: digestSha256,
    canonical_payload_sha256: digestSha256
  });
}

function validateReceiptRecord(record) {
  if (!isRecord(record) || !isRecord(record.payload) || !isRecord(record.signature)) {
    return "Receipt record must contain payload and signature objects.";
  }
  if (record.payload.schemaVersion !== RECORD_SCHEMA_VERSION) {
    return `Unsupported payload schemaVersion ${JSON.stringify(record.payload.schemaVersion)}.`;
  }
  if (typeof record.payload.receiptId !== "string" || !RECORD_RECEIPT_ID_PATTERN.test(record.payload.receiptId)) {
    return "payload.receiptId must match rct_<64 lowercase hex>.";
  }
  if (typeof record.payload.tenantSlug !== "string" || !TENANT_SLUG_PATTERN.test(record.payload.tenantSlug)) {
    return "payload.tenantSlug must be a valid tenant slug.";
  }
  if (!isIsoUtcTimestamp(record.payload.issuedAt)) {
    return "payload.issuedAt must be a valid UTC ISO-8601 date-time.";
  }
  if (
    record.signature.messageType !== "DIGEST" ||
    record.signature.algorithm !== RECORD_ALGORITHM ||
    typeof record.signature.digestSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(record.signature.digestSha256)
  ) {
    return "Receipt signature metadata must use DIGEST, RSASSA_PSS_SHA_256, and a lowercase SHA-256 digest.";
  }
  if (!isImmutableKmsKeyId(record.signature.keyId)) {
    return "Receipt signature keyId must be an immutable KMS key ARN or key UUID.";
  }
  try {
    decodeStrictBase64(record.signature.signatureBase64);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

export function verifyReceiptRecord(record, options = {}) {
  const normalizedOptions = {
    expectedKeyId: options.expectedKeyId,
    publicKeyPem: options.publicKeyPem,
    tenant: options.tenant,
    pssMode: options.pssMode ?? PSS_MODE_MESSAGE
  };
  const checks = [];
  const limitations = [
    "Receipt-record verification covers payload identity, digest binding, tenant/key expectations, and RSA-PSS signature validity.",
    "It does not check ledger completeness, AWS execution, KMS custody, or runtime integrity.",
    `RSA-PSS digest treatment: ${normalizedOptions.pssMode}.`
  ];
  if (!PSS_MODES.has(normalizedOptions.pssMode)) {
    checks.push(check("configuration", false, `Unsupported RSA-PSS digest treatment ${JSON.stringify(normalizedOptions.pssMode)}.`));
    return buildReport(checks, limitations, normalizedOptions);
  }
  const schemaError = validateReceiptRecord(record);
  if (schemaError) {
    checks.push(check("schema", false, schemaError));
    return buildReport(checks, limitations, normalizedOptions);
  }
  checks.push(check("schema", true, "Receipt record matches the standalone verifier's supported shape."));

  const tenantPassed = normalizedOptions.tenant === undefined || record.payload.tenantSlug === normalizedOptions.tenant;
  checks.push(
    check(
      "tenant",
      tenantPassed,
      normalizedOptions.tenant === undefined
        ? `No expected tenant supplied; observed ${record.payload.tenantSlug}.`
        : tenantPassed
          ? `Receipt tenantSlug matches expected tenant ${normalizedOptions.tenant}.`
          : `Receipt tenantSlug ${record.payload.tenantSlug} does not match expected tenant ${normalizedOptions.tenant}.`
    )
  );

  const { receiptId: _receiptId, ...withoutId } = record.payload;
  const canonicalPayload = canonicalize(record.payload);
  const receiptId = `rct_${sha256Hex(canonicalize(withoutId))}`;
  const digestSha256 = sha256Hex(canonicalPayload);
  checks.push(
    check(
      "receipt_id",
      record.payload.receiptId === receiptId,
      record.payload.receiptId === receiptId
        ? "receiptId recomputes from the canonical identity payload."
        : `Receipt id mismatch. Expected ${receiptId}; observed ${record.payload.receiptId}.`
    )
  );
  checks.push(
    check(
      "digest",
      record.signature.digestSha256 === digestSha256,
      record.signature.digestSha256 === digestSha256
        ? "Signature digestSha256 matches the recomputed canonical payload digest."
        : `Digest mismatch. Expected ${digestSha256}; observed ${record.signature.digestSha256}.`
    )
  );

  const keyPassed =
    normalizedOptions.expectedKeyId === undefined ||
    immutableKmsKeyIdsMatch(record.signature.keyId, normalizedOptions.expectedKeyId);
  checks.push(
    check(
      "key_id",
      keyPassed,
      keyPassed
        ? `Signature keyId ${record.signature.keyId} satisfies the expected immutable identity.`
        : `Signature keyId mismatch. Expected ${normalizedOptions.expectedKeyId}; observed ${record.signature.keyId}.`
    )
  );

  if (!checks.every((entry) => entry.passed)) {
    checks.push(check("signature", false, "Signature verification skipped because an earlier receipt check failed."));
  } else if (!normalizedOptions.publicKeyPem) {
    checks.push(check("signature", false, "A public key is required for receipt-record verification. Failing closed."));
  } else {
    let passed = false;
    let detail;
    try {
      passed = verifyRsaPssDigest(
        normalizedOptions.publicKeyPem,
        Buffer.from(digestSha256, "hex"),
        decodeStrictBase64(record.signature.signatureBase64),
        normalizedOptions.pssMode
      );
      detail = passed
        ? `RSA-PSS SHA-256 signature verifies with the supplied public key (${normalizedOptions.pssMode}).`
        : `RSA-PSS SHA-256 signature does not verify with the supplied public key (${normalizedOptions.pssMode}).`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    checks.push(check("signature", passed, detail));
  }

  return buildReport(checks, limitations, normalizedOptions, {
    receipt_id: receiptId,
    digest_sha256: digestSha256,
    canonical_payload_sha256: digestSha256
  });
}

export function verifyReceipt(receipt, options = {}) {
  return isRecord(receipt) && isRecord(receipt.payload) && isRecord(receipt.signature)
    ? verifyReceiptRecord(receipt, options)
    : verifyDecisionReceipt(receipt, options);
}

function usage() {
  return `Standalone Ghost-Ark receipt verifier (Node.js built-ins only)

Usage:
  node verifiers/node/ghost_receipt_verify.mjs --receipt <receipt.json> [options]

Options:
  --key <public-key.pem>          RSA public key for KMS-style or receipt-record verification.
  --expected-key-id <key-id>     Expected signing-key identity.
  --hmac-secret <test-vector>    Published dev-only HMAC fixture value; never a production credential.
  --tenant <tenant>              Receipt-record tenant slug, or decision tenant used with --identity-hmac-secret.
  --identity-hmac-secret <value> Published dev-only identity fixture value for a decision-receipt tenant check.
  --expected-tenant-id-hash <d>  Expected decision-receipt tenant commitment.
  --pss-mode <mode>              digest-as-message (local fixtures) or digest-as-mhash (AWS KMS DIGEST semantics).
  --help                         Show this help.
`;
}

function parseArgs(argv) {
  const options = { pssMode: PSS_MODE_MESSAGE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new TypeError(`Missing value for ${arg}.`);
    }
    if (arg === "--receipt") {
      options.receiptPath = next;
    } else if (arg === "--key" || arg === "--public-key") {
      options.publicKeyPath = next;
    } else if (arg === "--expected-key-id") {
      options.expectedKeyId = next;
    } else if (arg === "--hmac-secret") {
      options.hmacSecret = next;
    } else if (arg === "--tenant") {
      options.tenant = next;
    } else if (arg === "--identity-hmac-secret") {
      options.identityHmacSecret = next;
    } else if (arg === "--expected-tenant-id-hash") {
      options.expectedTenantIdHash = next;
    } else if (arg === "--pss-mode") {
      options.pssMode = next;
    } else {
      throw new TypeError(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  if (options.help) {
    return options;
  }
  if (!options.receiptPath) {
    throw new TypeError("--receipt is required.");
  }
  if (options.pssMode !== PSS_MODE_MESSAGE && options.pssMode !== PSS_MODE_MHASH) {
    throw new TypeError(`--pss-mode must be ${PSS_MODE_MESSAGE} or ${PSS_MODE_MHASH}.`);
  }
  return options;
}

function cliFailure(name, detail, options = {}) {
  return buildReport([check(name, false, detail)], [], { pssMode: options.pssMode ?? PSS_MODE_MESSAGE });
}

export function runCli(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const report = cliFailure("arguments", error instanceof Error ? error.message : String(error));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write("VERDICT: FAIL\n");
    return 1;
  }
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  let receipt;
  try {
    receipt = JSON.parse(readFileSync(options.receiptPath, "utf8"));
  } catch (error) {
    const report = cliFailure("load", `Could not load receipt: ${error instanceof Error ? error.message : String(error)}`, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write("VERDICT: FAIL\n");
    return 1;
  }

  let publicKeyPem;
  if (options.publicKeyPath) {
    try {
      publicKeyPem = readFileSync(options.publicKeyPath, "utf8");
      parseRsaPublicKey(publicKeyPem);
    } catch (error) {
      const report = cliFailure(
        "public_key",
        `Could not load public key: ${error instanceof Error ? error.message : String(error)}`,
        options
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write("VERDICT: FAIL\n");
      return 1;
    }
  }

  let report;
  try {
    report = verifyReceipt(receipt, { ...options, publicKeyPem });
  } catch (error) {
    report = cliFailure(
      "internal",
      `Verifier failed closed on unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      options
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`VERDICT: ${report.verdict}\n`);
  return report.verdict === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
