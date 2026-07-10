#!/usr/bin/env python3
"""Independent (non-TypeScript) verifier for Ghost-Ark receipts.

Purpose: verify Ghost-Ark receipt artifacts from first principles — canonical
payload reconstruction, receipt identity, strict signature-envelope decoding,
tenant expectation, key-identity binding, and RSA-PSS SHA-256 / dev-only HMAC
signature validity — without importing any Ghost-Ark TypeScript code and
without calling AWS. Python stdlib only. No third-party dependencies.

Supported input formats (auto-detected):
  1. ghost.receipt.v1 decision receipts (flat object with receipt_signature).
  2. ghost-ark.receipt.v1 receipt records ({payload, signature} objects, as in
     examples/sample-receipts/valid-receipt.json).

Minimal canonical JSON algorithm (documented contract, mirrors the subset of
Ghost-Ark canonicalization that committed receipts actually use):
  - Objects: keys sorted lexicographically; keys must be ASCII (fails closed
    otherwise, because JS sorts by UTF-16 code units and Python by code points,
    which can diverge outside ASCII).
  - No whitespace; separators are "," and ":".
  - Strings: JSON-escaped with ensure_ascii=False (matches JSON.stringify for
    the ASCII/BMP content committed receipts contain).
  - Numbers: integers only. Any non-integral number fails closed, because
    ECMAScript and Python float serialization can diverge.
  - true/false/null as JSON literals. NaN/Infinity fail closed.

RSA-PSS SHA-256 verification (pure stdlib, RFC 8017 EMSA-PSS-VERIFY with
MGF1-SHA256 and saltLen = 32). Two documented digest treatments exist:
  - digest-as-message (default): the 32-byte canonical-payload SHA-256 digest
    is treated as a *message* and hashed again inside PSS (mHash =
    SHA-256(digest)). This matches the Node `crypto.sign(null, digestBytes,
    RSA-PSS)` semantics used by Ghost-Ark's local KMS-style signing/verifying
    paths and by all committed repository fixtures.
  - digest-as-mhash: the digest is used directly as mHash. This matches AWS
    KMS `Sign` with MessageType=DIGEST and SigningAlgorithm
    RSASSA_PSS_SHA_256, i.e. what a signature produced by real AWS KMS over a
    precomputed digest verifies against.
  These two treatments are NOT interchangeable: a signature valid under one
  fails under the other. Select with --pss-mode. See
  docs/security/RECEIPT_ATTACK_CORPUS.md for the boundary discussion.

LIMITATIONS (explicit):
  - Integer-only number canonicalization; ASCII-only object keys.
  - Key manifest, chain, checkpoint, attestation, and Merkle-proof checks are
    not implemented here; use tools/ghost-verify.mjs for those modes.
  - HMAC verification is dev-only and requires the published dev-only test
    vector passed explicitly via --hmac-secret. It proves nothing about
    production signing.
  - RSA-PSS verification proves that the supplied public key verifies the
    signature bytes. It does not prove AWS KMS key custody, signing
    authorization inside AWS, hardware attestation, or runtime integrity.

NON-CLAIM: A PASS verdict proves internal receipt consistency under the rules
above. It does not prove model safety, semantic truth, compliance, alignment,
production readiness, or runtime integrity, and it is not AWS evidence.
"""

import argparse
import base64
import binascii
import hashlib
import hmac as hmac_lib
import json
import re
import sys

DECISION_SCHEMA_VERSION = "ghost.receipt.v1"
RECORD_SCHEMA_VERSION = "ghost-ark.receipt.v1"
ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1"
ENVELOPE_KEYS = {"schemaVersion", "keyId", "algorithm", "digestSha256", "signature"}
BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
STANDARD_BASE64_PATTERN = re.compile(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
SHA256_HEX_PATTERN = re.compile(r"^[a-f0-9]{64}$")
DIGEST_PATTERN = re.compile(r"^(sha256|hmac-sha256):[a-f0-9]{64}$")
RECEIPT_HASH_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
GRCT_PATTERN = re.compile(r"^grct_[a-f0-9]{64}$")
RCT_PATTERN = re.compile(r"^rct_[a-f0-9]{64}$")
EXECUTION_NONCE_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,256}$")
KMS_KEY_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
KMS_KEY_ARN_PATTERN = re.compile(
    r"^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
KMS_ALIAS_ARN_PATTERN = re.compile(r"^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:alias/.+$", re.IGNORECASE)

HMAC_ALGORITHM = "LOCAL_HMAC_SHA256_DEV_ONLY"
KMS_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256"
RECORD_ALGORITHM = "RSASSA_PSS_SHA_256"

PSS_MODE_MESSAGE = "digest-as-message"
PSS_MODE_MHASH = "digest-as-mhash"

REPORT_SCHEMA_VERSION = "ghost.python_verifier_report.v2"
NON_CLAIM = (
    "A PASS verdict proves internal receipt consistency under the documented minimal "
    "canonicalization rules. It does not prove model safety, semantic truth, compliance, "
    "or runtime integrity, and it is not AWS evidence."
)

# Exact ghost.receipt.v1 field contract, mirrored from
# packages/enforcement-runtime/src/receipts/schema.ts (strict field set).
# Fields mapped to True receive the listed default when absent, matching the
# TypeScript schema defaults so both verifiers canonicalize identically.
DECISION_REQUIRED_FIELDS = (
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
    "signature_alg",
)
DECISION_DEFAULTED_FIELDS = {
    "retrieved_context_digests": [],
    "action_taken": [],
    "prev_receipt_hash": None,
}
DECISION_ALL_FIELDS = set(DECISION_REQUIRED_FIELDS) | set(DECISION_DEFAULTED_FIELDS) | {"receipt_signature"}
DECISION_KINDS = {"ALLOW", "ALLOW_WITH_CONSTRAINTS", "REDACT", "REFUSE", "ESCALATE"}
CONSENT_STATES = {"granted", "denied", "missing", "not_required"}


class CanonicalizationError(ValueError):
    """Raised when a value cannot be canonicalized identically to Ghost-Ark."""


class PublicKeyError(ValueError):
    """Raised when a supplied public key cannot be parsed strictly."""


def canonicalize(value):
    """Deterministic minimal canonical JSON. Fails closed on anything that could
    serialize differently between Python and ECMAScript."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise CanonicalizationError(
            "Non-integer numbers are not supported by this minimal canonicalizer (float serialization may diverge from ECMAScript)."
        )
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str) or not key.isascii():
                raise CanonicalizationError("Object keys must be ASCII strings (UTF-16 vs code-point sort order may diverge).")
        parts = []
        for key in sorted(value.keys()):
            parts.append(json.dumps(key, ensure_ascii=False) + ":" + canonicalize(value[key]))
        return "{" + ",".join(parts) + "}"
    raise CanonicalizationError(f"Unsupported value type for canonical JSON: {type(value).__name__}")


def sha256_hex(text):
    try:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()
    except UnicodeEncodeError as error:
        raise CanonicalizationError(f"Canonical text is not UTF-8 encodable: {error}") from error


def sha256_bytes(text):
    try:
        return hashlib.sha256(text.encode("utf-8")).digest()
    except UnicodeEncodeError as error:
        raise CanonicalizationError(f"Canonical text is not UTF-8 encodable: {error}") from error


def check(name, passed, detail):
    return {"name": name, "passed": bool(passed), "detail": detail}


# ---------------------------------------------------------------------------
# KMS key-identity rules (ported from
# packages/enforcement-runtime/src/aws/kmsKeyIdentity.ts)
# ---------------------------------------------------------------------------

def is_kms_alias_key_id(key_id):
    return key_id.startswith("alias/") or bool(KMS_ALIAS_ARN_PATTERN.match(key_id))


def is_immutable_kms_key_id(key_id):
    return bool(KMS_KEY_UUID_PATTERN.match(key_id)) or bool(KMS_KEY_ARN_PATTERN.match(key_id))


def key_uuid_from_immutable_key_id(key_id):
    return key_id[key_id.rfind("/") + 1 :] if ":key/" in key_id else key_id


def immutable_kms_key_ids_match(first, second):
    if not is_immutable_kms_key_id(first) or not is_immutable_kms_key_id(second):
        return False
    if KMS_KEY_ARN_PATTERN.match(first) and KMS_KEY_ARN_PATTERN.match(second):
        return first == second
    return key_uuid_from_immutable_key_id(first) == key_uuid_from_immutable_key_id(second)


# ---------------------------------------------------------------------------
# Pure-stdlib SPKI RSA public key parsing (fail closed on any malformation)
# ---------------------------------------------------------------------------

RSA_ENCRYPTION_OID = bytes.fromhex("2a864886f70d010101")  # 1.2.840.113549.1.1.1


def pem_to_der(pem_text):
    lines = [line.strip() for line in pem_text.strip().splitlines() if line.strip()]
    if len(lines) < 3 or lines[0] != "-----BEGIN PUBLIC KEY-----" or lines[-1] != "-----END PUBLIC KEY-----":
        raise PublicKeyError("Public key must be a single SPKI PEM block (-----BEGIN PUBLIC KEY-----).")
    try:
        return base64.b64decode("".join(lines[1:-1]), validate=True)
    except (binascii.Error, ValueError) as error:
        raise PublicKeyError(f"Public key PEM body is not valid base64: {error}") from error


class _DerReader:
    def __init__(self, data, pos=0, end=None):
        self.data = data
        self.pos = pos
        self.end = len(data) if end is None else end

    def read_tlv(self):
        if self.pos + 2 > self.end:
            raise PublicKeyError("Truncated DER structure.")
        tag = self.data[self.pos]
        length = self.data[self.pos + 1]
        offset = self.pos + 2
        if length & 0x80:
            num_octets = length & 0x7F
            if num_octets == 0 or num_octets > 4 or offset + num_octets > self.end:
                raise PublicKeyError("Unsupported or truncated DER length encoding.")
            length = int.from_bytes(self.data[offset : offset + num_octets], "big")
            if length < 0x80:
                raise PublicKeyError("Non-minimal DER length encoding.")
            offset += num_octets
        if offset + length > self.end:
            raise PublicKeyError("DER value overruns its container.")
        value = self.data[offset : offset + length]
        self.pos = offset + length
        return tag, value

    def at_end(self):
        return self.pos == self.end


def _der_positive_integer(raw):
    if len(raw) == 0:
        raise PublicKeyError("Empty DER INTEGER.")
    if raw[0] & 0x80:
        raise PublicKeyError("Negative DER INTEGER where a positive value is required.")
    if len(raw) > 1 and raw[0] == 0x00 and not (raw[1] & 0x80):
        raise PublicKeyError("Non-minimal DER INTEGER encoding.")
    return int.from_bytes(raw, "big")


def parse_spki_rsa_public_key(pem_text):
    """Parse an SPKI PEM into (n, e). Accepts only rsaEncryption keys with
    2048..8192-bit moduli and odd public exponents >= 3. Fails closed otherwise."""
    der = pem_to_der(pem_text)
    outer = _DerReader(der)
    tag, spki_body = outer.read_tlv()
    if tag != 0x30 or not outer.at_end():
        raise PublicKeyError("SPKI must be exactly one DER SEQUENCE.")
    spki = _DerReader(spki_body)
    tag, alg_body = spki.read_tlv()
    if tag != 0x30:
        raise PublicKeyError("SPKI AlgorithmIdentifier must be a SEQUENCE.")
    alg = _DerReader(alg_body)
    tag, oid = alg.read_tlv()
    if tag != 0x06 or oid != RSA_ENCRYPTION_OID:
        raise PublicKeyError("Public key algorithm must be rsaEncryption (1.2.840.113549.1.1.1).")
    if not alg.at_end():
        tag, params = alg.read_tlv()
        if tag != 0x05 or params != b"" or not alg.at_end():
            raise PublicKeyError("rsaEncryption parameters must be a single DER NULL.")
    tag, bit_string = spki.read_tlv()
    if tag != 0x03 or len(bit_string) < 1 or bit_string[0] != 0x00 or not spki.at_end():
        raise PublicKeyError("SPKI subjectPublicKey must be a BIT STRING with zero unused bits.")
    pk = _DerReader(bit_string[1:])
    tag, rsa_body = pk.read_tlv()
    if tag != 0x30 or not pk.at_end():
        raise PublicKeyError("RSAPublicKey must be exactly one DER SEQUENCE.")
    rsa = _DerReader(rsa_body)
    tag, n_raw = rsa.read_tlv()
    if tag != 0x02:
        raise PublicKeyError("RSA modulus must be a DER INTEGER.")
    tag, e_raw = rsa.read_tlv()
    if tag != 0x02 or not rsa.at_end():
        raise PublicKeyError("RSA public exponent must be the final DER INTEGER.")
    n = _der_positive_integer(n_raw)
    e = _der_positive_integer(e_raw)
    if not 2048 <= n.bit_length() <= 8192:
        raise PublicKeyError(f"RSA modulus size {n.bit_length()} bits is outside the accepted 2048..8192 range.")
    if e < 3 or e % 2 == 0:
        raise PublicKeyError("RSA public exponent must be an odd integer >= 3.")
    return n, e


# ---------------------------------------------------------------------------
# RSA-PSS SHA-256 verification (RFC 8017 sections 8.1.2 and 9.1.2)
# ---------------------------------------------------------------------------

PSS_SALT_LENGTH = 32  # SHA-256 digest length; matches RSA_PSS_SALTLEN_DIGEST and KMS.


def _mgf1_sha256(seed, mask_length):
    counter = 0
    output = b""
    while len(output) < mask_length:
        output += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    return output[:mask_length]


def _emsa_pss_verify_sha256(m_hash, em, em_bits, salt_length):
    h_len = 32
    em_len = (em_bits + 7) // 8
    if len(m_hash) != h_len or len(em) != em_len:
        return False
    if em_len < h_len + salt_length + 2:
        return False
    if em[-1] != 0xBC:
        return False
    masked_db = em[: em_len - h_len - 1]
    h_value = em[em_len - h_len - 1 : em_len - 1]
    top_bits = 8 * em_len - em_bits
    if top_bits and masked_db[0] >> (8 - top_bits):
        return False
    db_mask = _mgf1_sha256(h_value, em_len - h_len - 1)
    db = bytes(x ^ y for x, y in zip(masked_db, db_mask))
    if top_bits:
        db = bytes([db[0] & (0xFF >> top_bits)]) + db[1:]
    ps_length = em_len - h_len - salt_length - 2
    if any(db[:ps_length]) or db[ps_length] != 0x01:
        return False
    salt = db[ps_length + 1 :]
    h_prime = hashlib.sha256(b"\x00" * 8 + m_hash + salt).digest()
    return hmac_lib.compare_digest(h_prime, h_value)


def rsa_pss_sha256_verify(public_key, digest_bytes, signature_bytes, pss_mode):
    """Verify an RSASSA-PSS SHA-256 signature over a 32-byte canonical-payload
    digest under the selected digest treatment (see module docstring)."""
    n, e = public_key
    if len(digest_bytes) != 32:
        return False
    if pss_mode == PSS_MODE_MESSAGE:
        m_hash = hashlib.sha256(digest_bytes).digest()
    elif pss_mode == PSS_MODE_MHASH:
        m_hash = digest_bytes
    else:
        return False
    mod_bits = n.bit_length()
    k = (mod_bits + 7) // 8
    if len(signature_bytes) != k:
        return False
    s = int.from_bytes(signature_bytes, "big")
    if s >= n:
        return False
    m = pow(s, e, n)
    em_bits = mod_bits - 1
    em_len = (em_bits + 7) // 8
    em = m.to_bytes(em_len, "big")
    return _emsa_pss_verify_sha256(m_hash, em, em_bits, PSS_SALT_LENGTH)


# ---------------------------------------------------------------------------
# Strict signature-envelope decoding (ghost.decision_receipt_signature.v1)
# ---------------------------------------------------------------------------

def decode_envelope(receipt_signature, checks):
    """Strict envelope decoding: unpadded base64url charset, exact field set,
    supported schemaVersion, standard-base64 signature."""
    if not isinstance(receipt_signature, str) or not receipt_signature:
        checks.append(check("envelope", False, "receipt_signature must be a non-empty string."))
        return None
    if not BASE64URL_PATTERN.match(receipt_signature):
        checks.append(check("envelope", False, "receipt_signature must be unpadded base64url text."))
        return None
    padded = receipt_signature + "=" * (-len(receipt_signature) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
        envelope = json.loads(decoded)
    except (ValueError, UnicodeDecodeError):
        checks.append(check("envelope", False, "receipt_signature must be a base64url-encoded JSON signature envelope."))
        return None
    if not isinstance(envelope, dict):
        checks.append(check("envelope", False, "receipt_signature envelope must decode to an object."))
        return None
    if set(envelope.keys()) != ENVELOPE_KEYS:
        checks.append(check("envelope", False, "receipt_signature envelope contains an unexpected field set."))
        return None
    if envelope.get("schemaVersion") != ENVELOPE_SCHEMA_VERSION:
        checks.append(check("envelope", False, "receipt_signature envelope has an unsupported schemaVersion."))
        return None
    for field in ("keyId", "algorithm", "digestSha256", "signature"):
        if not isinstance(envelope.get(field), str) or not envelope[field]:
            checks.append(check("envelope", False, f"receipt_signature envelope field {field} must be a non-empty string."))
            return None
    if not STANDARD_BASE64_PATTERN.match(envelope["signature"]):
        checks.append(check("envelope", False, "signature must be standard base64-encoded bytes."))
        return None
    if not SHA256_HEX_PATTERN.match(envelope["digestSha256"]):
        checks.append(check("envelope", False, "digestSha256 must be a lowercase SHA-256 hex digest."))
        return None
    return envelope


# ---------------------------------------------------------------------------
# ghost.receipt.v1 decision receipt verification
# ---------------------------------------------------------------------------

def _validate_decision_schema(receipt, checks):
    """Strict field-set and shape validation mirroring the TypeScript schema.
    Returns the receipt with TypeScript-equivalent defaults filled, or None."""
    if not isinstance(receipt, dict):
        checks.append(check("schema", False, "Receipt must be a JSON object."))
        return None
    if receipt.get("schema_version") != DECISION_SCHEMA_VERSION:
        checks.append(check("schema", False, f"Unsupported schema_version: {receipt.get('schema_version')!r}."))
        return None
    unknown = sorted(set(receipt.keys()) - DECISION_ALL_FIELDS)
    if unknown:
        checks.append(check("schema", False, f"Receipt contains unknown fields: {', '.join(unknown)}."))
        return None
    missing = [field for field in DECISION_REQUIRED_FIELDS if field not in receipt]
    if "receipt_signature" not in receipt:
        missing.append("receipt_signature")
    if missing:
        checks.append(check("schema", False, f"Receipt is missing required fields: {', '.join(missing)}."))
        return None

    filled = dict(receipt)
    for field, default in DECISION_DEFAULTED_FIELDS.items():
        if field not in filled:
            filled[field] = json.loads(json.dumps(default))

    def fail(detail):
        checks.append(check("schema", False, detail))

    if not isinstance(filled["receipt_id"], str) or not GRCT_PATTERN.match(filled["receipt_id"]):
        fail("receipt_id must match grct_<64 lowercase hex>.")
        return None
    for field in ("tenant_id_hash", "user_id_hash", "session_id_hash", "input_digest", "execution_context_hash"):
        if not isinstance(filled[field], str) or not DIGEST_PATTERN.match(filled[field]):
            fail(f"{field} must be a sha256: or hmac-sha256: digest.")
            return None
    if not isinstance(filled["policy_hash"], str) or not SHA256_HEX_PATTERN.match(filled["policy_hash"]):
        fail("policy_hash must be 64 lowercase hex characters.")
        return None
    if not isinstance(filled["execution_nonce"], str) or not EXECUTION_NONCE_PATTERN.match(filled["execution_nonce"]):
        fail("execution_nonce must match the accepted nonce charset and length.")
        return None
    for field in ("request_id", "model_id", "policy_version", "timestamp"):
        if not isinstance(filled[field], str) or not filled[field]:
            fail(f"{field} must be a non-empty string.")
            return None
    if filled["decision_pre"] not in DECISION_KINDS or filled["decision_post"] not in DECISION_KINDS:
        fail("decision_pre/decision_post must be known decision kinds.")
        return None
    if filled["consent_state"] not in CONSENT_STATES:
        fail("consent_state must be a known consent state.")
        return None
    if not isinstance(filled["memory_written"], bool):
        fail("memory_written must be a boolean.")
        return None
    if not isinstance(filled["retrieved_context_digests"], list) or not all(
        isinstance(item, str) and DIGEST_PATTERN.match(item) for item in filled["retrieved_context_digests"]
    ):
        fail("retrieved_context_digests must be a list of digests.")
        return None
    if not isinstance(filled["action_taken"], list) or not all(
        isinstance(item, str) and item for item in filled["action_taken"]
    ):
        fail("action_taken must be a list of non-empty strings.")
        return None
    prev_hash = filled["prev_receipt_hash"]
    if prev_hash is not None and (not isinstance(prev_hash, str) or not RECEIPT_HASH_PATTERN.match(prev_hash)):
        fail("prev_receipt_hash must be null or a sha256: digest.")
        return None
    if filled["signature_alg"] not in (HMAC_ALGORITHM, KMS_ALGORITHM):
        fail(f"Unsupported signature_alg {filled['signature_alg']!r}.")
        return None
    if not isinstance(filled["receipt_signature"], str) or not filled["receipt_signature"]:
        fail("receipt_signature must be a non-empty string.")
        return None

    checks.append(check("schema", True, "Receipt matches the strict ghost.receipt.v1 field contract."))
    return filled


def _tenant_expectation_check(observed_tenant_hash, options, checks):
    expected_hash = options.get("expected_tenant_id_hash")
    tenant = options.get("tenant")
    identity_secret = options.get("identity_hmac_secret")
    if expected_hash is None and tenant is None:
        return
    if expected_hash is None:
        if not identity_secret:
            checks.append(
                check(
                    "tenant_expectation",
                    False,
                    "Cannot verify a tenant expectation for a decision receipt without --identity-hmac-secret "
                    "or --expected-tenant-id-hash: tenant_id_hash is a keyed HMAC commitment. Failing closed.",
                )
            )
            return
        expected_hash = "hmac-sha256:" + hmac_lib.new(
            identity_secret.encode("utf-8"), tenant.encode("utf-8"), hashlib.sha256
        ).hexdigest()
    matches = hmac_lib.compare_digest(str(expected_hash), str(observed_tenant_hash))
    checks.append(
        check(
            "tenant_expectation",
            matches,
            "Receipt tenant_id_hash matches the expected tenant commitment."
            if matches
            else "Receipt tenant_id_hash does not match the expected tenant commitment.",
        )
    )


def verify_decision_receipt(receipt, options):
    checks = []
    limitations = [
        "Integer-only number canonicalization.",
        "ASCII-only object keys.",
        "No key manifest, chain, checkpoint, or attestation checks (use tools/ghost-verify.mjs).",
        "HMAC verification is dev-only and requires an explicitly supplied published test vector.",
        "RSA-PSS verification proves the supplied public key verifies the signature bytes; it is not AWS KMS custody or provenance evidence.",
        f"RSA-PSS digest treatment: {options['pss_mode']} (see --pss-mode; the two treatments are not interchangeable).",
    ]

    filled = _validate_decision_schema(receipt, checks)
    if filled is None:
        return build_report(checks, limitations, options)

    unsigned = {key: value for key, value in filled.items() if key != "receipt_signature"}
    without_id = {key: value for key, value in unsigned.items() if key != "receipt_id"}

    try:
        canonical_payload = canonicalize(unsigned)
        canonical_without_id = canonicalize(without_id)
        checks.append(check("canonical_payload", True, "Unsigned receipt canonicalized under the documented minimal rules."))
    except CanonicalizationError as error:
        checks.append(check("canonical_payload", False, str(error)))
        return build_report(checks, limitations, options)

    recomputed_digest = sha256_hex(canonical_payload)
    recomputed_receipt_id = "grct_" + sha256_hex(canonical_without_id)

    checks.append(
        check(
            "receipt_id",
            recomputed_receipt_id == filled["receipt_id"],
            "receipt_id recomputes from the canonical unsigned receipt."
            if recomputed_receipt_id == filled["receipt_id"]
            else f"Receipt id mismatch. Recomputed {recomputed_receipt_id}; observed {filled['receipt_id']}.",
        )
    )

    envelope = decode_envelope(filled["receipt_signature"], checks)
    signature_alg = filled["signature_alg"]
    if envelope is None:
        checks.append(check("signature", False, "Signature verification skipped because envelope decoding failed."))
        report = build_report(checks, limitations, options)
        report["recomputed"] = {
            "receipt_id": recomputed_receipt_id,
            "digest_sha256": recomputed_digest,
            "canonical_payload_sha256": recomputed_digest,
        }
        _tenant_expectation_check(filled["tenant_id_hash"], options, report["checks"])
        report["verdict"] = "PASS" if all(entry["passed"] for entry in report["checks"]) else "FAIL"
        return report

    if envelope["algorithm"] != signature_alg:
        checks.append(
            check(
                "envelope",
                False,
                f"Envelope algorithm {envelope['algorithm']} does not match receipt signature_alg {signature_alg}.",
            )
        )
    else:
        checks.append(check("envelope", True, "Signature envelope decodes strictly and its algorithm matches signature_alg."))

    embedded_key_id = envelope["keyId"]
    expected_key_id = options.get("expected_key_id")
    if signature_alg == KMS_ALGORITHM:
        if not is_immutable_kms_key_id(embedded_key_id):
            key_id_passed = False
            key_id_detail = "Signature keyId must be an immutable KMS key ARN or key UUID. Mutable aliases are not accepted for signed evidence."
        elif expected_key_id and not immutable_kms_key_ids_match(embedded_key_id, expected_key_id):
            key_id_passed = False
            key_id_detail = f"Signature keyId mismatch. Expected {expected_key_id}; observed {embedded_key_id}."
        else:
            key_id_passed = True
            key_id_detail = f"Signature keyId {embedded_key_id} is an immutable KMS key identity."
    else:
        if expected_key_id and embedded_key_id != expected_key_id:
            key_id_passed = False
            key_id_detail = f"Signature keyId mismatch. Expected {expected_key_id}; observed {embedded_key_id}."
        else:
            key_id_passed = True
            key_id_detail = f"Signature keyId {embedded_key_id} is present."
    checks.append(check("key_id", key_id_passed, key_id_detail))

    digest_matches = envelope["digestSha256"] == recomputed_digest
    checks.append(
        check(
            "digest",
            digest_matches,
            "Envelope digestSha256 equals the recomputed canonical unsigned receipt digest."
            if digest_matches
            else f"Digest mismatch. Expected {recomputed_digest}; observed {envelope['digestSha256']}.",
        )
    )

    prerequisites_passed = all(entry["passed"] for entry in checks)
    if not prerequisites_passed:
        checks.append(check("signature", False, "Signature verification skipped because earlier checks failed."))
    elif signature_alg == HMAC_ALGORITHM:
        hmac_secret = options.get("hmac_secret")
        if hmac_secret:
            expected = base64.b64encode(
                hmac_lib.new(hmac_secret.encode("utf-8"), canonical_payload.encode("utf-8"), hashlib.sha256).digest()
            ).decode("ascii")
            matches = hmac_lib.compare_digest(expected, envelope["signature"])
            checks.append(
                check(
                    "signature",
                    matches,
                    "Dev-only HMAC signature verifies over the canonical unsigned receipt."
                    if matches
                    else "Dev-only HMAC signature does not verify over the canonical unsigned receipt.",
                )
            )
        else:
            checks.append(
                check(
                    "signature",
                    False,
                    "HMAC signature not verified: pass the published dev-only test vector via --hmac-secret. Failing closed.",
                )
            )
    elif signature_alg == KMS_ALGORITHM:
        public_key = options.get("public_key")
        if public_key is not None:
            try:
                signature_bytes = base64.b64decode(envelope["signature"], validate=True)
            except (binascii.Error, ValueError):
                signature_bytes = None
            if signature_bytes is None:
                checks.append(check("signature", False, "Envelope signature is not valid standard base64."))
            else:
                digest_bytes = bytes.fromhex(recomputed_digest)
                valid = rsa_pss_sha256_verify(public_key, digest_bytes, signature_bytes, options["pss_mode"])
                checks.append(
                    check(
                        "signature",
                        valid,
                        f"RSA-PSS SHA-256 signature verifies with the supplied public key ({options['pss_mode']})."
                        if valid
                        else f"RSA-PSS SHA-256 signature does not verify with the supplied public key ({options['pss_mode']}).",
                    )
                )
        elif options.get("allow_unverified_signature"):
            checks.append(
                check(
                    "signature",
                    True,
                    "RSA-PSS signature NOT verified (no --key supplied); accepted only because "
                    "--allow-unverified-signature was passed. Digest and receipt_id checks above still hold.",
                )
            )
        else:
            checks.append(
                check(
                    "signature",
                    False,
                    "No public key supplied for a KMS-algorithm receipt. Pass --key <spki.pem>, or "
                    "--allow-unverified-signature to accept digest-only verification. Failing closed.",
                )
            )
    else:
        checks.append(check("signature", False, f"Unknown signature_alg {signature_alg!r}. Failing closed."))

    _tenant_expectation_check(filled["tenant_id_hash"], options, checks)

    report = build_report(checks, limitations, options)
    report["recomputed"] = {
        "receipt_id": recomputed_receipt_id,
        "digest_sha256": recomputed_digest,
        "canonical_payload_sha256": recomputed_digest,
    }
    return report


# ---------------------------------------------------------------------------
# ghost-ark.receipt.v1 receipt-record verification
# ---------------------------------------------------------------------------

def verify_receipt_record(record, options):
    checks = []
    limitations = [
        "Integer-only number canonicalization.",
        "ASCII-only object keys.",
        "Receipt-record verification covers payload identity, digest binding, and RSA-PSS signature validity only.",
        f"RSA-PSS digest treatment: {options['pss_mode']} (see --pss-mode; the two treatments are not interchangeable).",
    ]

    payload = record.get("payload")
    signature = record.get("signature")
    if not isinstance(payload, dict) or not isinstance(signature, dict):
        checks.append(check("schema", False, "Receipt record must contain payload and signature objects."))
        return build_report(checks, limitations, options)
    if payload.get("schemaVersion") != RECORD_SCHEMA_VERSION:
        checks.append(check("schema", False, f"Unsupported payload schemaVersion: {payload.get('schemaVersion')!r}."))
        return build_report(checks, limitations, options)
    if not isinstance(payload.get("receiptId"), str) or not RCT_PATTERN.match(payload["receiptId"]):
        checks.append(check("schema", False, "payload.receiptId must match rct_<64 lowercase hex>."))
        return build_report(checks, limitations, options)
    checks.append(check("schema", True, "Receipt record contains payload and signature objects."))

    tenant = options.get("tenant")
    if tenant is not None:
        matches = payload.get("tenantSlug") == tenant
        checks.append(
            check(
                "tenant",
                matches,
                f"Receipt tenantSlug matches expected tenant {tenant}."
                if matches
                else f"Receipt tenantSlug {payload.get('tenantSlug')!r} does not match expected tenant {tenant}.",
            )
        )
    else:
        checks.append(check("tenant", True, f"No expected tenant supplied; observed tenantSlug {payload.get('tenantSlug')!r}."))

    try:
        without_id = {key: value for key, value in payload.items() if key != "receiptId"}
        canonical_identity = canonicalize(without_id)
        canonical_payload = canonicalize(payload)
        checks.append(check("canonical_payload", True, "Receipt payload canonicalized under the documented minimal rules."))
    except CanonicalizationError as error:
        checks.append(check("canonical_payload", False, str(error)))
        return build_report(checks, limitations, options)

    recomputed_receipt_id = "rct_" + sha256_hex(canonical_identity)
    recomputed_digest = sha256_hex(canonical_payload)

    checks.append(
        check(
            "receipt_id",
            recomputed_receipt_id == payload["receiptId"],
            "receiptId recomputes from the canonical identity payload."
            if recomputed_receipt_id == payload["receiptId"]
            else f"Receipt id mismatch. Recomputed {recomputed_receipt_id}; observed {payload['receiptId']}.",
        )
    )

    digest_matches = signature.get("digestSha256") == recomputed_digest
    checks.append(
        check(
            "digest",
            digest_matches,
            "Signature digestSha256 matches the recomputed canonical payload digest."
            if digest_matches
            else f"Digest mismatch. Expected {recomputed_digest}; observed {signature.get('digestSha256')!r}.",
        )
    )

    algorithm_ok = signature.get("messageType") == "DIGEST" and signature.get("algorithm") == RECORD_ALGORITHM
    checks.append(
        check(
            "algorithm",
            algorithm_ok,
            "Signature metadata uses DIGEST and RSASSA_PSS_SHA_256."
            if algorithm_ok
            else f"Unsupported signature metadata: {signature.get('messageType')!r} / {signature.get('algorithm')!r}.",
        )
    )

    expected_key_id = options.get("expected_key_id")
    embedded_key_id = signature.get("keyId")
    if expected_key_id is not None:
        key_id_ok = isinstance(embedded_key_id, str) and immutable_kms_key_ids_match(embedded_key_id, expected_key_id)
        checks.append(
            check(
                "key_id",
                key_id_ok,
                f"Signature keyId matches the expected immutable KMS key identity."
                if key_id_ok
                else f"Signature keyId mismatch. Expected {expected_key_id}; observed {embedded_key_id!r}.",
            )
        )

    signature_b64 = signature.get("signatureBase64")
    if not isinstance(signature_b64, str) or not signature_b64 or not STANDARD_BASE64_PATTERN.match(signature_b64):
        checks.append(check("signature", False, "signature.signatureBase64 must be standard base64-encoded bytes."))
    elif not all(entry["passed"] for entry in checks):
        checks.append(check("signature", False, "Signature verification skipped because earlier checks failed."))
    else:
        public_key = options.get("public_key")
        if public_key is None:
            checks.append(check("signature", False, "No public key supplied. Pass --key <spki.pem>. Failing closed."))
        else:
            signature_bytes = base64.b64decode(signature_b64, validate=True)
            digest_bytes = bytes.fromhex(recomputed_digest)
            valid = rsa_pss_sha256_verify(public_key, digest_bytes, signature_bytes, options["pss_mode"])
            checks.append(
                check(
                    "signature",
                    valid,
                    f"RSA-PSS SHA-256 signature verifies with the supplied public key ({options['pss_mode']})."
                    if valid
                    else f"RSA-PSS SHA-256 signature does not verify with the supplied public key ({options['pss_mode']}).",
                )
            )

    report = build_report(checks, limitations, options)
    report["recomputed"] = {
        "receipt_id": recomputed_receipt_id,
        "digest_sha256": recomputed_digest,
        "canonical_payload_sha256": recomputed_digest,
    }
    return report


# ---------------------------------------------------------------------------
# Report assembly and CLI
# ---------------------------------------------------------------------------

def build_report(checks, limitations, options=None):
    report = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "verifier": "verifiers/python/ghost_receipt_verify.py",
        "verdict": "PASS" if checks and all(entry["passed"] for entry in checks) else "FAIL",
        "checks": checks,
        "limitations": limitations,
        "non_claim": NON_CLAIM,
    }
    if options is not None:
        report["pss_mode"] = options.get("pss_mode")
    return report


def detect_format(receipt):
    if isinstance(receipt, dict) and isinstance(receipt.get("payload"), dict) and isinstance(receipt.get("signature"), dict):
        return "record"
    return "decision"


def main(argv):
    parser = argparse.ArgumentParser(
        description="Independent Python verifier for Ghost-Ark receipts (stdlib only; no AWS; no Ghost-Ark TypeScript imports)."
    )
    parser.add_argument("--receipt", required=True, help="Path to a receipt JSON file (decision receipt or receipt record).")
    parser.add_argument("--key", default=None, help="Path to an SPKI PEM RSA public key for RSA-PSS SHA-256 verification.")
    parser.add_argument(
        "--tenant",
        default=None,
        help="Expected tenant. Receipt records: compared to payload.tenantSlug. Decision receipts: combined with "
        "--identity-hmac-secret to recompute the expected tenant_id_hash commitment.",
    )
    parser.add_argument(
        "--identity-hmac-secret",
        default=None,
        help="Published dev-only identity HMAC test vector used to recompute tenant_id_hash for --tenant on decision receipts.",
    )
    parser.add_argument(
        "--expected-tenant-id-hash",
        default=None,
        help="Expected tenant_id_hash commitment for decision receipts (alternative to --tenant + --identity-hmac-secret).",
    )
    parser.add_argument("--expected-key-id", default=None, help="Expected signature keyId (immutable KMS key identity for KMS-algorithm receipts).")
    parser.add_argument(
        "--hmac-secret",
        default=None,
        help="Published dev-only HMAC test vector for LOCAL_HMAC_SHA256_DEV_ONLY fixtures. Never a production credential.",
    )
    parser.add_argument(
        "--pss-mode",
        choices=[PSS_MODE_MESSAGE, PSS_MODE_MHASH],
        default=PSS_MODE_MESSAGE,
        help=f"RSA-PSS digest treatment. {PSS_MODE_MESSAGE}: digest is hashed again inside PSS (matches Ghost-Ark local "
        f"fixtures and Node local verification). {PSS_MODE_MHASH}: digest is used directly as mHash (matches AWS KMS "
        "MessageType=DIGEST signatures). Default: %(default)s.",
    )
    parser.add_argument(
        "--allow-unverified-signature",
        action="store_true",
        help="Accept KMS-algorithm decision receipts without a public key (signature explicitly reported unverified).",
    )
    args = parser.parse_args(argv)

    def finish(report):
        print(json.dumps(report, indent=2))
        verdict = report["verdict"]
        print(f"VERDICT: {verdict}", file=sys.stderr)
        return 0 if verdict == "PASS" else 1

    try:
        with open(args.receipt, "r", encoding="utf-8") as handle:
            receipt = json.load(handle)
    except (OSError, ValueError) as error:
        return finish(build_report([check("load", False, f"Could not load receipt: {error}")], []))

    public_key = None
    if args.key is not None:
        try:
            with open(args.key, "r", encoding="utf-8") as handle:
                public_key = parse_spki_rsa_public_key(handle.read())
        except (OSError, PublicKeyError) as error:
            return finish(build_report([check("public_key", False, f"Could not load public key: {error}")], []))

    options = {
        "public_key": public_key,
        "tenant": args.tenant,
        "identity_hmac_secret": args.identity_hmac_secret,
        "expected_tenant_id_hash": args.expected_tenant_id_hash,
        "expected_key_id": args.expected_key_id,
        "hmac_secret": args.hmac_secret,
        "pss_mode": args.pss_mode,
        "allow_unverified_signature": args.allow_unverified_signature,
    }

    try:
        if detect_format(receipt) == "record":
            report = verify_receipt_record(receipt, options)
        else:
            report = verify_decision_receipt(receipt, options)
    except Exception as error:  # noqa: BLE001 — any unexpected error must fail closed, never pass silently.
        report = build_report([check("internal", False, f"Verifier failed closed on unexpected error: {error}")], [])

    return finish(report)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
