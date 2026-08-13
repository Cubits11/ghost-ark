#!/usr/bin/env python3
"""
Ghost-Ark decision-receipt verification in which every security-relevant
decision is delegated to software this repository did not write.

WHY THIS EXISTS
---------------
`docs/research/EXPERIMENTS.md` records, as an open gap: "No third-party
reimplementation. E5 reports agreement across three verifiers written by the
same author from the same specification; they can share a misreading."

That gap is real and this file does NOT close it. What it does is remove this
project's code from every step where a misreading would be silent:

    canonical JSON      CPython `json` (native), not a re-implementation
    SHA-256             `openssl dgst -sha256`
    HMAC-SHA-256        `openssl dgst -sha256 -hmac`
    RSASSA-PSS          `openssl pkeyutl -verify -pkeyopt rsa_padding_mode:pss`
    base64 / base64url  CPython `base64` (native)

Ghost-Ark contributes only the *rule sequencing*: which checks run, over which
fields, in what order. So a shared misreading of SHA-256, of PSS, of MGF1, or of
base64url is now impossible — a different set of authors decides those. A shared
misreading of the receipt rules themselves is NOT addressed, and could not be by
anything written inside this repository.

WHAT AGREEMENT HERE MEANS, AND WHAT IT DOES NOT
-----------------------------------------------
Agreement means: two implementations that share no cryptographic code reach the
same accept/reject decision on these fixtures. It is not an audit, not a proof
of rule completeness, and not evidence about model safety, compliance, or AWS
behaviour. Disagreement is the informative direction and is reported as a
finding rather than reconciled.

NO GHOST-ARK IMPORTS. This file imports the Python standard library only, and
shells out to `openssl`. `tests/unit/experiments/thirdPartyVerifier.test.ts`
asserts that property against the source text, because a verifier that quietly
imports the thing it is checking is not an independent arm.

Usage:
  python3 ghost_receipt_verify_thirdparty.py --receipt R.json
        [--key public.pem] [--hmac-secret S] [--expected-key-id ID]
        [--tenant SLUG] [--identity-hmac-secret S]
        [--pss-mode digest-as-message|digest-as-mhash|auto]
"""

import argparse
import base64
import binascii
import json
import os
import re
import subprocess
import sys
import tempfile

NON_CLAIM = (
    "This verifier checks receipt shape, canonical identity, digest, and signature using "
    "third-party primitives (CPython json/base64 and the OpenSSL CLI). It does not establish "
    "evidence truth, AI safety, compliance, deployment correctness, or AWS behaviour. "
    "Agreement with another implementation is differential evidence over these fixtures only."
)

PSS_MODE_MESSAGE = "digest-as-message"
PSS_MODE_MHASH = "digest-as-mhash"

ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1"
ENVELOPE_KEYS = frozenset({"schemaVersion", "keyId", "algorithm", "digestSha256", "signature"})

IMMUTABLE_KMS_ARN = re.compile(
    r"^arn:aws[a-zA-Z-]*:kms:[a-z0-9-]+:\d{12}:key/[0-9a-fA-F-]{36}$"
)
IMMUTABLE_KMS_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class OpenSslUnavailable(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Third-party primitives. Nothing below computes cryptography in this process.
# ---------------------------------------------------------------------------


def _openssl(args, stdin_bytes=None):
    try:
        return subprocess.run(
            ["openssl"] + args, input=stdin_bytes, capture_output=True, check=False
        )
    except FileNotFoundError as exc:  # pragma: no cover - environment dependent
        raise OpenSslUnavailable("openssl is not on PATH") from exc


def openssl_version():
    result = _openssl(["version"])
    return result.stdout.decode("utf-8", "replace").strip()


def sha256_hex(data: bytes) -> str:
    """SHA-256 by OpenSSL. Deliberately not hashlib: hashlib is CPython's own
    implementation and OpenSSL's CLI is a second, separately maintained one."""
    result = _openssl(["dgst", "-sha256", "-hex"], data)
    if result.returncode != 0:
        raise RuntimeError(f"openssl dgst failed: {result.stderr.decode('utf-8', 'replace')}")
    text = result.stdout.decode("ascii").strip()
    return text.rsplit("=", 1)[-1].strip() if "=" in text else text.split()[-1]


def hmac_sha256_b64(secret: str, data: bytes) -> str:
    result = _openssl(["dgst", "-sha256", "-hmac", secret, "-binary"], data)
    if result.returncode != 0:
        raise RuntimeError(f"openssl hmac failed: {result.stderr.decode('utf-8', 'replace')}")
    return base64.b64encode(result.stdout).decode("ascii")


def hmac_sha256_hex(secret: str, data: bytes) -> str:
    return base64.b64decode(hmac_sha256_b64(secret, data)).hex()


def rsa_pss_verify(public_key_pem_path: str, mhash: bytes, signature: bytes) -> bool:
    """RSASSA-PSS verification by the OpenSSL CLI.

    `mhash` is the value RFC 8017 calls mHash. `openssl pkeyutl -verify` without
    `-rawin` treats its input as exactly that, which is also AWS KMS
    `MessageType=DIGEST` semantics.
    """
    with tempfile.TemporaryDirectory() as tmp:
        hash_path = os.path.join(tmp, "mhash.bin")
        sig_path = os.path.join(tmp, "sig.bin")
        with open(hash_path, "wb") as handle:
            handle.write(mhash)
        with open(sig_path, "wb") as handle:
            handle.write(signature)
        result = _openssl(
            [
                "pkeyutl",
                "-verify",
                "-pubin",
                "-inkey",
                public_key_pem_path,
                "-sigfile",
                sig_path,
                "-in",
                hash_path,
                "-pkeyopt",
                "rsa_padding_mode:pss",
                "-pkeyopt",
                "digest:sha256",
                "-pkeyopt",
                "rsa_pss_saltlen:digest",
            ]
        )
        return result.returncode == 0


def canonicalize(value) -> str:
    """Canonical JSON by CPython's own serializer.

    Ghost-Ark's canonicalizer is "JSON with object keys sorted by UTF-16 code
    unit and no insignificant whitespace". CPython's `json.dumps` with
    sort_keys=True, ensure_ascii=False and compact separators is an independent
    implementation of the same shape, written by different people. Whether the
    two actually agree is a MEASUREMENT, not an assumption — E14 reports it per
    fixture, and a disagreement is a finding about canonical identity.
    """
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Rule sequencing. This part is Ghost-Ark's, and is the part still unaudited.
# ---------------------------------------------------------------------------


def check(name, passed, detail):
    return {"name": name, "passed": bool(passed), "detail": detail}


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def is_immutable_kms_key_id(value: str) -> bool:
    return bool(IMMUTABLE_KMS_ARN.match(value) or IMMUTABLE_KMS_UUID.match(value))


def immutable_kms_key_ids_match(left: str, right: str) -> bool:
    def key_uuid(value):
        if IMMUTABLE_KMS_UUID.match(value):
            return value.lower()
        if IMMUTABLE_KMS_ARN.match(value):
            return value.rsplit("/", 1)[-1].lower()
        return None

    left_uuid, right_uuid = key_uuid(left), key_uuid(right)
    return left_uuid is not None and left_uuid == right_uuid


def verify(options):
    checks = []
    raw = None
    try:
        with open(options["receipt"], "rb") as handle:
            raw = handle.read()
        receipt = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - a parse failure is a verdict
        checks.append(check("schema", False, f"Receipt did not parse as JSON: {exc}"))
        return {"verdict": "FAIL", "checks": checks, "recomputed": None}

    if not isinstance(receipt, dict):
        checks.append(check("schema", False, "Receipt must decode to a JSON object."))
        return {"verdict": "FAIL", "checks": checks, "recomputed": None}

    required = ["receipt_id", "schema_version", "signature_alg", "receipt_signature", "timestamp"]
    missing = [field for field in required if field not in receipt]
    checks.append(
        check(
            "schema",
            not missing,
            "Receipt carries the required decision-receipt fields."
            if not missing
            else f"Missing required field(s): {', '.join(missing)}.",
        )
    )
    if missing:
        return {"verdict": "FAIL", "checks": checks, "recomputed": None}

    unsigned = {key: value for key, value in receipt.items() if key != "receipt_signature"}
    canonical_payload = canonicalize(unsigned)
    identity_source = {key: value for key, value in unsigned.items() if key != "receipt_id"}
    recomputed_id = "grct_" + sha256_hex(canonicalize(identity_source).encode("utf-8"))
    recomputed_digest = sha256_hex(canonical_payload.encode("utf-8"))

    checks.append(
        check(
            "receipt_id",
            recomputed_id == receipt["receipt_id"],
            "Receipt id matches the canonical unsigned envelope."
            if recomputed_id == receipt["receipt_id"]
            else f"Receipt id mismatch. Expected {recomputed_id}; observed {receipt['receipt_id']}.",
        )
    )

    envelope = None
    envelope_detail = "Signature envelope is strict canonical base64url JSON with the expected field set."
    envelope_ok = False
    signature_raw = receipt.get("receipt_signature")
    if not isinstance(signature_raw, str):
        envelope_detail = "receipt_signature must be a string."
    elif re.search(r"[^A-Za-z0-9_-]", signature_raw):
        envelope_detail = "receipt_signature must be unpadded base64url."
    else:
        try:
            envelope = json.loads(b64url_decode(signature_raw).decode("utf-8"))
            if not isinstance(envelope, dict):
                envelope_detail = "Signature envelope must decode to an object."
                envelope = None
            else:
                # The envelope field set is EXACT and its schemaVersion is pinned.
                # Both rules were absent from the first version of this arm, and
                # E14's differential is what surfaced that: MAL-007 and MAL-008
                # were accepted here and rejected by Ghost-Ark. Recorded rather
                # than quietly fixed, because "the independent arm was missing a
                # rule" and "the implementations disagree" look identical in a
                # summary count and mean completely different things.
                observed_keys = set(envelope.keys())
                if observed_keys != ENVELOPE_KEYS:
                    envelope_detail = (
                        "receipt_signature envelope has an unexpected field set: "
                        f"{sorted(observed_keys)}."
                    )
                    envelope = None
                elif envelope.get("schemaVersion") != ENVELOPE_SCHEMA_VERSION:
                    envelope_detail = (
                        "receipt_signature envelope has an unsupported schemaVersion "
                        f"{envelope.get('schemaVersion')}."
                    )
                    envelope = None
                elif envelope.get("algorithm") != receipt["signature_alg"]:
                    envelope_detail = (
                        f"Envelope algorithm {envelope.get('algorithm')} does not match "
                        f"receipt signature_alg {receipt['signature_alg']}."
                    )
                elif not isinstance(envelope.get("keyId"), str) or not envelope["keyId"]:
                    envelope_detail = "receipt_signature envelope keyId must be non-empty."
                elif not isinstance(envelope.get("digestSha256"), str) or not re.fullmatch(
                    r"[0-9a-f]{64}", envelope["digestSha256"]
                ):
                    envelope_detail = "receipt_signature envelope digestSha256 must be lowercase sha-256 hex."
                elif not isinstance(envelope.get("signature"), str) or not re.fullmatch(
                    r"[A-Za-z0-9+/]+={0,2}", envelope["signature"]
                ):
                    envelope_detail = "receipt_signature envelope signature must be standard base64."
                else:
                    envelope_ok = True
        except (ValueError, binascii.Error) as exc:
            envelope_detail = f"Signature envelope did not decode: {exc}"
    checks.append(check("envelope", envelope_ok, envelope_detail))

    envelope = envelope or {}
    embedded_key_id = envelope.get("keyId") if isinstance(envelope.get("keyId"), str) else ""
    embedded_digest = envelope.get("digestSha256") if isinstance(envelope.get("digestSha256"), str) else ""
    embedded_signature = envelope.get("signature") if isinstance(envelope.get("signature"), str) else ""

    expected_key_id = options.get("expected_key_id")
    requires_immutable = receipt["signature_alg"] == "KMS_SIGN_RSASSA_PSS_SHA_256"
    if not embedded_key_id:
        key_id_ok, key_id_detail = False, "Signature envelope does not contain a keyId."
    elif requires_immutable and not is_immutable_kms_key_id(embedded_key_id):
        key_id_ok, key_id_detail = False, "Signature keyId must be an immutable KMS key ARN or key UUID."
    elif expected_key_id:
        key_id_ok = (
            immutable_kms_key_ids_match(embedded_key_id, expected_key_id)
            if requires_immutable
            else embedded_key_id == expected_key_id
        )
        key_id_detail = (
            f"Signature keyId {embedded_key_id} is present."
            if key_id_ok
            else f"Signature keyId mismatch. Expected {expected_key_id}; observed {embedded_key_id}."
        )
    else:
        key_id_ok, key_id_detail = True, f"Signature keyId {embedded_key_id} is present."
    checks.append(check("key_id", key_id_ok, key_id_detail))

    checks.append(
        check(
            "digest",
            embedded_digest == recomputed_digest,
            "Embedded signature digest matches the recomputed canonical digest."
            if embedded_digest == recomputed_digest
            else f"Digest mismatch. Expected {recomputed_digest}; observed {embedded_digest}.",
        )
    )
    checks.append(
        check(
            "canonical_payload",
            len(canonical_payload) > 0,
            "Canonical unsigned decision receipt payload was recomputed.",
        )
    )

    tenant_expectation = options.get("tenant")
    if tenant_expectation is not None:
        identity_secret = options.get("identity_hmac_secret") or ""
        expected_hash = "hmac-sha256:" + hmac_sha256_hex(identity_secret, tenant_expectation.encode("utf-8"))
        observed_hash = receipt.get("tenant_id_hash")
        checks.append(
            check(
                "tenant_expectation",
                expected_hash == observed_hash,
                "Receipt tenant_id_hash matches the expected tenant."
                if expected_hash == observed_hash
                else "Receipt tenant_id_hash does not match the expected tenant.",
            )
        )

    pss_accepted_modes = []
    prerequisites = all(entry["passed"] for entry in checks)
    if not embedded_signature:
        checks.append(check("signature", False, "Signature envelope does not contain a signature."))
    elif not prerequisites:
        checks.append(check("signature", False, "Signature verification skipped because an earlier check failed."))
    else:
        algorithm = receipt["signature_alg"]
        try:
            if algorithm == "LOCAL_HMAC_SHA256_DEV_ONLY":
                secret = options.get("hmac_secret")
                if not secret:
                    checks.append(check("signature", False, "No --hmac-secret supplied for an HMAC receipt."))
                else:
                    expected = hmac_sha256_b64(secret, canonical_payload.encode("utf-8"))
                    ok = expected == embedded_signature
                    checks.append(
                        check(
                            "signature",
                            ok,
                            "HMAC signature verifies (OpenSSL)."
                            if ok
                            else "HMAC signature does not verify (OpenSSL).",
                        )
                    )
            elif algorithm == "KMS_SIGN_RSASSA_PSS_SHA_256":
                key_path = options.get("key")
                if not key_path:
                    checks.append(check("signature", False, "No --key supplied for an RSA receipt."))
                else:
                    signature_bytes = base64.b64decode(embedded_signature)
                    digest_bytes = bytes.fromhex(recomputed_digest)
                    # Adjudicate BOTH treatments with the same external oracle and
                    # record which one the bytes satisfy. The modes are not
                    # interchangeable; which one a fixture uses is a fact about the
                    # fixture, and previously only this project's own code said so.
                    if rsa_pss_verify(key_path, digest_bytes, signature_bytes):
                        pss_accepted_modes.append(PSS_MODE_MHASH)
                    if rsa_pss_verify(
                        key_path, bytes.fromhex(sha256_hex(digest_bytes)), signature_bytes
                    ):
                        pss_accepted_modes.append(PSS_MODE_MESSAGE)
                    requested = options.get("pss_mode", "auto")
                    ok = bool(pss_accepted_modes) if requested == "auto" else requested in pss_accepted_modes
                    checks.append(
                        check(
                            "signature",
                            ok,
                            f"RSA-PSS verifies under {'/'.join(pss_accepted_modes)} (OpenSSL)."
                            if ok
                            else f"RSA-PSS does not verify under {requested} (OpenSSL); "
                            f"accepted modes: {pss_accepted_modes or 'none'}.",
                        )
                    )
            else:
                checks.append(check("signature", False, f"Unsupported signature_alg {algorithm}."))
        except OpenSslUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - a crypto failure is a verdict
            checks.append(check("signature", False, f"Signature verification error: {exc}"))

    return {
        "verdict": "PASS" if all(entry["passed"] for entry in checks) else "FAIL",
        "checks": checks,
        "recomputed": {"receipt_id": recomputed_id, "digest_sha256": recomputed_digest},
        "pss_accepted_modes": pss_accepted_modes,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Ghost-Ark receipt verification over third-party primitives.")
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--key")
    parser.add_argument("--hmac-secret", dest="hmac_secret")
    parser.add_argument("--expected-key-id", dest="expected_key_id")
    parser.add_argument("--tenant")
    parser.add_argument("--identity-hmac-secret", dest="identity_hmac_secret")
    parser.add_argument(
        "--pss-mode",
        dest="pss_mode",
        default="auto",
        choices=[PSS_MODE_MESSAGE, PSS_MODE_MHASH, "auto"],
    )
    parsed = parser.parse_args(argv)

    try:
        version = openssl_version()
    except OpenSslUnavailable as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stdout)
        print(f"VERDICT: ERROR ({exc})", file=sys.stderr)
        return 2

    report = verify(vars(parsed))
    report["schema_version"] = "ghost.thirdparty_verifier_report.v1"
    report["primitives"] = {
        "canonical_json": f"CPython {sys.version.split()[0]} json (native)",
        "digest": version,
        "hmac": version,
        "rsa_pss": version,
        "base64": f"CPython {sys.version.split()[0]} base64 (native)",
    }
    report["non_claim"] = NON_CLAIM
    print(json.dumps(report, indent=2))
    print(f"VERDICT: {report['verdict']}", file=sys.stderr)
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
