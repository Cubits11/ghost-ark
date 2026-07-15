#!/usr/bin/env node

/**
 * Standalone Ghost-Ark receipt v2 verifier.
 *
 * Independence boundary:
 * - imports Node.js built-ins only;
 * - does not import the receipt emitter, production verifier, schemas, or any
 *   Ghost-Ark package;
 * - reimplements canonicalization, receipt identity, digest binding, the
 *   signature envelope decode, and dev-only HMAC verification in this file;
 * - additionally recomputes execution_trace shape and ordering, the v2
 *   surface that makes assertion-vs-record divergence receipt-detectable.
 *
 * A PASS verdict establishes internal consistency under the rules implemented
 * here only. It does not prove model safety, semantic truth, compliance, AWS
 * execution, KMS custody, runtime integrity, or complete attack coverage. It
 * does NOT establish that the tool responses recorded in execution_trace were
 * truthful — only that the receipt commits to specific gateway-recorded
 * digests.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const V2_SCHEMA_VERSION = "ghost.receipt.v2";
export const ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1";
const HMAC_ALGORITHM = "LOCAL_HMAC_SHA256_DEV_ONLY";
const KMS_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ANY_DIGEST = /^(?:sha256|hmac-sha256):[a-f0-9]{64}$/u;
const POLICY_HASH = /^[a-f0-9]{64}$/u;
const RECEIPT_ID = /^grct2_[a-f0-9]{64}$/u;
const NONCE = /^[A-Za-z0-9._:-]{8,256}$/u;
const TOOL_NAME = /^[A-Za-z0-9._:-]{1,256}$/u;
const TRACE_CLASSES = new Set(["GATEWAY_RECORDED", "SOURCE_SIGNED", "EXTERNALLY_ATTESTED"]);

const NON_CLAIM =
  "A PASS verdict proves internal v2 receipt consistency under this standalone verifier's documented rules. " +
  "It does not prove the recorded tool responses were truthful, nor model safety, compliance, or AWS execution.";

function canonicalize(value) {
  if (value === undefined) throw new Error("undefined is not canonicalizable");
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error("non-plain object is not canonicalizable");
    }
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new Error(`unsupported value of type ${typeof value}`);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function fail(checks, name, detail) {
  checks.push({ name, passed: false, detail });
}

function pass(checks, name, detail) {
  checks.push({ name, passed: true, detail });
}

function decodeEnvelope(receiptSignature) {
  if (typeof receiptSignature !== "string" || !/^[A-Za-z0-9_-]+$/u.test(receiptSignature)) {
    throw new Error("receipt_signature must be unpadded base64url text");
  }
  const parsed = JSON.parse(Buffer.from(receiptSignature, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("envelope must decode to an object");
  }
  const expected = ["algorithm", "digestSha256", "keyId", "schemaVersion", "signature"].sort();
  const observed = Object.keys(parsed).sort();
  if (observed.length !== expected.length || observed.some((k, i) => k !== expected[i])) {
    throw new Error("envelope has an unexpected field set");
  }
  return parsed;
}

function checkTrace(checks, trace) {
  if (!Array.isArray(trace)) {
    fail(checks, "execution_trace", "execution_trace must be an array.");
    return;
  }
  let previous = -1;
  let ok = true;
  for (let i = 0; i < trace.length; i += 1) {
    const entry = trace[i];
    if (!entry || typeof entry !== "object") {
      ok = false;
      break;
    }
    if (!Number.isSafeInteger(entry.sequence_num) || entry.sequence_num < 0) { ok = false; break; }
    if (i > 0 && entry.sequence_num <= previous) { ok = false; break; }
    if (typeof entry.tool_name !== "string" || !TOOL_NAME.test(entry.tool_name)) { ok = false; break; }
    if (!SHA256_DIGEST.test(entry.request_payload_digest)) { ok = false; break; }
    if (!SHA256_DIGEST.test(entry.response_payload_digest)) { ok = false; break; }
    if (!TRACE_CLASSES.has(entry.provenance_class)) { ok = false; break; }
    previous = entry.sequence_num;
  }
  if (ok) {
    pass(checks, "execution_trace", `execution_trace has ${trace.length} strictly ordered gateway-recorded entries.`);
  } else {
    fail(checks, "execution_trace", "execution_trace failed shape, ordering, or class validation.");
  }
}

export function verifyReceiptV2(receipt, options = {}) {
  const checks = [];

  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { verdict: false, checks: [{ name: "shape", passed: false, detail: "receipt must be an object." }], nonClaim: NON_CLAIM };
  }
  if (receipt.schema_version !== V2_SCHEMA_VERSION) {
    fail(checks, "schema_version", `expected ${V2_SCHEMA_VERSION}.`);
    return { verdict: false, checks, nonClaim: NON_CLAIM };
  }
  pass(checks, "schema_version", "schema_version is ghost.receipt.v2.");

  for (const [name, pattern] of [
    ["tenant_id_hash", ANY_DIGEST],
    ["input_digest", ANY_DIGEST],
    ["execution_context_hash", SHA256_DIGEST],
    ["policy_hash", POLICY_HASH],
    ["execution_nonce", NONCE]
  ]) {
    if (typeof receipt[name] !== "string" || !pattern.test(receipt[name])) {
      fail(checks, name, `${name} failed shape validation.`);
    } else {
      pass(checks, name, `${name} is well-formed.`);
    }
  }

  checkTrace(checks, receipt.execution_trace);

  const { receipt_signature, ...unsignedWithId } = receipt;
  const { receipt_id, ...identityPayload } = unsignedWithId;
  const expectedId = `grct2_${sha256Hex(canonicalize(identityPayload))}`;
  if (!RECEIPT_ID.test(receipt_id ?? "")) {
    fail(checks, "receipt_id_shape", "receipt_id does not match grct2 pattern.");
  } else if (expectedId !== receipt_id) {
    fail(checks, "receipt_id", `receipt_id mismatch. expected ${expectedId}; observed ${receipt_id}.`);
  } else {
    pass(checks, "receipt_id", "receipt_id matches canonical unsigned identity payload.");
  }

  const canonicalUnsigned = canonicalize(unsignedWithId);
  const recomputedDigest = sha256Hex(canonicalUnsigned);

  let envelope;
  try {
    envelope = decodeEnvelope(receipt_signature);
    pass(checks, "envelope", "signature envelope is strict base64url JSON with the expected field set.");
  } catch (error) {
    fail(checks, "envelope", error.message);
    return { verdict: false, checks, nonClaim: NON_CLAIM };
  }

  if (envelope.digestSha256 !== recomputedDigest) {
    fail(checks, "digest", `digest mismatch. expected ${recomputedDigest}; observed ${envelope.digestSha256}.`);
  } else {
    pass(checks, "digest", "envelope digest matches recomputed canonical digest.");
  }

  if (options.expectedTenantHash && receipt.tenant_id_hash !== options.expectedTenantHash) {
    fail(checks, "tenant_expectation", "tenant_id_hash does not match expected value.");
  }

  if (envelope.algorithm === HMAC_ALGORITHM) {
    if (!options.hmacSecret) {
      fail(checks, "signature", "HMAC verification requested but no hmac-secret provided.");
    } else {
      const expected = createHmac("sha256", options.hmacSecret).update(canonicalUnsigned).digest();
      let observed;
      try {
        observed = Buffer.from(envelope.signature, "base64");
      } catch {
        observed = Buffer.alloc(0);
      }
      const match = expected.length === observed.length && timingSafeEqual(expected, observed);
      checks.push({ name: "signature", passed: match, detail: match ? "dev-only HMAC signature verified over canonical v2 payload." : "dev-only HMAC signature mismatch." });
    }
  } else if (envelope.algorithm === KMS_ALGORITHM) {
    fail(checks, "signature", "KMS RSA-PSS verification is out of scope for this bounded v2 verifier.");
  } else {
    fail(checks, "signature", `unsupported signature algorithm ${envelope.algorithm}.`);
  }

  return { verdict: checks.every((c) => c.passed), checks, nonClaim: NON_CLAIM };
}
