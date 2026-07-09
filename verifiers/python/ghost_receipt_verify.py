#!/usr/bin/env python3
"""Independent (non-TypeScript) verifier skeleton for Ghost-Ark decision receipts.

Purpose: recompute a ghost.receipt.v1 decision receipt's canonical payload,
receipt_id, and digestSha256 from first principles, decode the signature
envelope strictly, and (optionally, dev-only) verify the local HMAC signature —
without importing any Ghost-Ark TypeScript code. Python stdlib only.

Minimal canonical JSON algorithm (documented contract, mirrors the subset of
Ghost-Ark canonicalization that decision receipts actually use):
  - Objects: keys sorted lexicographically; keys must be ASCII (fails closed
    otherwise, because JS sorts by UTF-16 code units and Python by code points,
    which can diverge outside ASCII).
  - No whitespace; separators are "," and ":".
  - Strings: JSON-escaped with ensure_ascii=False (matches JSON.stringify for
    the ASCII/BMP content decision receipts contain).
  - Numbers: integers only. Any non-integral number fails closed, because
    ECMAScript and Python float serialization can diverge.
  - true/false/null as JSON literals. NaN/Infinity fail closed.

LIMITATIONS (explicit):
  - No RSA-PSS verification: the Python stdlib has no RSA. KMS-algorithm
    receipts get digest/receipt_id/envelope checks only; the signature check is
    reported as not implemented and the verdict ignores it only when
    --allow-unverified-signature is passed, otherwise it fails closed.
  - HMAC verification is dev-only and requires the published dev-only test
    vector passed explicitly via --hmac-secret. It proves nothing about
    production signing.
  - Number handling is integer-only by design (see above).
  - Key manifest, chain, checkpoint, and tenant-expectation checks are not
    implemented here.

NON-CLAIM: A PASS verdict proves internal receipt consistency under the rules
above. It does not prove model safety, semantic truth, compliance, alignment,
production readiness, or runtime integrity, and it is not AWS evidence.
"""

import argparse
import base64
import hashlib
import hmac as hmac_lib
import json
import re
import sys

SCHEMA_VERSION = "ghost.receipt.v1"
ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1"
ENVELOPE_KEYS = {"schemaVersion", "keyId", "algorithm", "digestSha256", "signature"}
BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
STANDARD_BASE64_PATTERN = re.compile(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
REPORT_SCHEMA_VERSION = "ghost.python_verifier_report.v1"
NON_CLAIM = (
    "A PASS verdict proves internal receipt consistency under the documented minimal "
    "canonicalization rules. It does not prove model safety, semantic truth, compliance, "
    "or runtime integrity, and it is not AWS evidence."
)


class CanonicalizationError(ValueError):
    """Raised when a value cannot be canonicalized identically to Ghost-Ark."""


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
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def decode_envelope(receipt_signature, checks):
    """Strict envelope decoding: unpadded base64url charset, exact field set,
    supported schemaVersion, standard-base64 signature."""
    if not isinstance(receipt_signature, str) or not receipt_signature:
        checks.append(check("envelope_strict_decode", False, "receipt_signature must be a non-empty string."))
        return None
    if not BASE64URL_PATTERN.match(receipt_signature):
        checks.append(check("envelope_strict_decode", False, "receipt_signature must be unpadded base64url text."))
        return None
    padded = receipt_signature + "=" * (-len(receipt_signature) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
        envelope = json.loads(decoded)
    except (ValueError, UnicodeDecodeError):
        checks.append(check("envelope_strict_decode", False, "receipt_signature must be a base64url-encoded JSON signature envelope."))
        return None
    if not isinstance(envelope, dict):
        checks.append(check("envelope_strict_decode", False, "receipt_signature envelope must decode to an object."))
        return None
    if set(envelope.keys()) != ENVELOPE_KEYS:
        checks.append(check("envelope_strict_decode", False, "receipt_signature envelope contains an unexpected field set."))
        return None
    if envelope.get("schemaVersion") != ENVELOPE_SCHEMA_VERSION:
        checks.append(check("envelope_strict_decode", False, "receipt_signature envelope has an unsupported schemaVersion."))
        return None
    signature = envelope.get("signature")
    if not isinstance(signature, str) or not signature or not STANDARD_BASE64_PATTERN.match(signature):
        checks.append(check("envelope_strict_decode", False, "signature must be standard base64-encoded bytes."))
        return None
    checks.append(check("envelope_strict_decode", True, "Signature envelope decodes with the exact expected field set."))
    return envelope


def check(name, passed, detail):
    return {"name": name, "passed": bool(passed), "detail": detail}


def verify_receipt(receipt, hmac_secret=None, allow_unverified_signature=False):
    checks = []
    limitations = [
        "No RSA-PSS verification (Python stdlib has no RSA).",
        "Integer-only number canonicalization.",
        "ASCII-only object keys.",
        "No key manifest, chain, checkpoint, or tenant-expectation checks.",
        "HMAC verification is dev-only and requires an explicitly supplied published test vector.",
    ]

    if not isinstance(receipt, dict):
        checks.append(check("schema", False, "Receipt must be a JSON object."))
        return build_report(checks, limitations)
    if receipt.get("schema_version") != SCHEMA_VERSION:
        checks.append(check("schema", False, f"Unsupported schema_version: {receipt.get('schema_version')!r}."))
        return build_report(checks, limitations)
    if "receipt_signature" not in receipt or "receipt_id" not in receipt:
        checks.append(check("schema", False, "Receipt must contain receipt_id and receipt_signature."))
        return build_report(checks, limitations)
    checks.append(check("schema", True, "Receipt has schema_version ghost.receipt.v1, receipt_id, and receipt_signature."))

    unsigned = {key: value for key, value in receipt.items() if key != "receipt_signature"}
    without_id = {key: value for key, value in unsigned.items() if key != "receipt_id"}

    try:
        canonical_payload = canonicalize(unsigned)
        canonical_without_id = canonicalize(without_id)
        checks.append(check("canonical_payload", True, "Unsigned receipt canonicalized under the documented minimal rules."))
    except CanonicalizationError as error:
        checks.append(check("canonical_payload", False, str(error)))
        return build_report(checks, limitations)

    recomputed_digest = sha256_hex(canonical_payload)
    recomputed_receipt_id = "grct_" + sha256_hex(canonical_without_id)

    checks.append(
        check(
            "receipt_id",
            recomputed_receipt_id == receipt["receipt_id"],
            "receipt_id recomputes from the canonical unsigned receipt."
            if recomputed_receipt_id == receipt["receipt_id"]
            else f"receipt_id mismatch. Recomputed {recomputed_receipt_id}; observed {receipt['receipt_id']}.",
        )
    )

    envelope = decode_envelope(receipt.get("receipt_signature"), checks)
    signature_alg = receipt.get("signature_alg")

    if envelope is not None:
        checks.append(
            check(
                "envelope_algorithm",
                envelope["algorithm"] == signature_alg,
                "Envelope algorithm matches receipt signature_alg."
                if envelope["algorithm"] == signature_alg
                else f"Envelope algorithm {envelope['algorithm']} does not match receipt signature_alg {signature_alg}.",
            )
        )
        checks.append(
            check(
                "digest",
                envelope["digestSha256"] == recomputed_digest,
                "Envelope digestSha256 equals the recomputed canonical unsigned receipt digest."
                if envelope["digestSha256"] == recomputed_digest
                else f"Digest mismatch. Envelope {envelope['digestSha256']}; recomputed {recomputed_digest}.",
            )
        )

        if signature_alg == "LOCAL_HMAC_SHA256_DEV_ONLY":
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
        elif signature_alg == "KMS_SIGN_RSASSA_PSS_SHA_256":
            checks.append(
                check(
                    "signature",
                    bool(allow_unverified_signature),
                    "RSA-PSS verification is not implemented in this stdlib-only skeleton. "
                    + (
                        "Reported as unverified (accepted only because --allow-unverified-signature was passed; digest and receipt_id checks above still hold)."
                        if allow_unverified_signature
                        else "Failing closed; re-run with --allow-unverified-signature to accept digest-only verification, or use tools/repro/verify-repro-manifest.ts for full RSA-PSS verification."
                    ),
                )
            )
        else:
            checks.append(check("signature", False, f"Unknown signature_alg {signature_alg!r}. Failing closed."))

    report = build_report(checks, limitations)
    report["recomputed"] = {
        "receipt_id": recomputed_receipt_id,
        "digest_sha256": recomputed_digest,
        "canonical_payload_sha256": recomputed_digest,
    }
    return report


def build_report(checks, limitations):
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "verifier": "verifiers/python/ghost_receipt_verify.py",
        "verdict": "PASS" if checks and all(entry["passed"] for entry in checks) else "FAIL",
        "checks": checks,
        "limitations": limitations,
        "non_claim": NON_CLAIM,
    }


def main(argv):
    parser = argparse.ArgumentParser(description="Independent Python verifier skeleton for Ghost-Ark decision receipts.")
    parser.add_argument("--receipt", required=True, help="Path to a ghost.receipt.v1 decision receipt JSON file.")
    parser.add_argument(
        "--hmac-secret",
        default=None,
        help="Published dev-only HMAC test vector for LOCAL_HMAC_SHA256_DEV_ONLY fixtures. Never a production credential.",
    )
    parser.add_argument(
        "--allow-unverified-signature",
        action="store_true",
        help="Accept KMS-algorithm receipts with digest/receipt_id checks only (signature explicitly reported unverified).",
    )
    args = parser.parse_args(argv)

    try:
        with open(args.receipt, "r", encoding="utf-8") as handle:
            receipt = json.load(handle)
    except (OSError, ValueError) as error:
        report = build_report([check("load", False, f"Could not load receipt: {error}")], [])
        print(json.dumps(report, indent=2))
        return 1

    report = verify_receipt(receipt, hmac_secret=args.hmac_secret, allow_unverified_signature=args.allow_unverified_signature)
    print(json.dumps(report, indent=2))
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
