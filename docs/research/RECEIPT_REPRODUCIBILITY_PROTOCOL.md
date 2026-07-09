# Receipt Reproducibility Protocol
## Purpose

This protocol defines how Ghost-Ark decision receipt fixtures are independently replayed from committed artifacts.

The goal is not to trust the README, the author, or a runtime log. The goal is to let a reviewer recompute the core receipt commitments:

- `receipt_id`
- canonical unsigned receipt payload
- `digestSha256`
- signature envelope binding
- signature verification result where supported

## Scope

This protocol applies to Ghost-Ark decision receipts using:

- `schema_version = ghost.receipt.v1`
- `receipt_id` prefix `grct_`
- snake_case receipt fields
- `receipt_signature` as base64url-encoded canonical JSON envelope

This protocol does not cover the older evidence receipt family using `ghost-ark.receipt.v1` and `rct_`.

## Claim Boundary

A passing reproducibility report proves internal receipt consistency under Ghost-Ark verifier rules.

It does not prove:

- model safety
- semantic truth
- compliance
- alignment
- production readiness
- AWS-live execution
- KMS key custody
- runtime integrity
- hardware attestation
- ledger completeness
- dataset representativeness

## Receipt Identity Algorithm

For a signed decision receipt:

1. Validate the signed receipt against `ghost.receipt.v1`.
2. Remove `receipt_signature`.
3. Let the result be the unsigned receipt.
4. Remove `receipt_id` from the unsigned receipt.
5. Canonicalize the unsigned-without-id object.
6. Compute:

```text
receipt_id = "grct_" + sha256hex(canonicalize(unsigned_without_receipt_id))

The receipt identity therefore binds the unsigned decision receipt fields except receipt_id itself.
```


# Digest Algorithm
For the same signed decision receipt:

1. Remove receipt_signature.
2. Canonicalize the unsigned receipt, including receipt_id.
3. Compute: digestSha256 = sha256hex(canonicalize(unsigned_receipt))

This digest is expected to equal the digestSha256 field embedded inside the decoded signature envelope.

# Signature Envelope

The receipt_signature field is expected to be base64url-encoded JSON containing exactly:
{
  "schemaVersion": "ghost.decision_receipt_signature.v1",
  "keyId": "...",
  "algorithm": "...",
  "digestSha256": "...",
  "signature": "..."
}

The verifier must reject:

* unsupported schemaVersion
* missing fields
* extra fields
* malformed base64url
* standard base64 where base64url is required
* algorithm mismatch between envelope and receipt
* digest mismatch between envelope and recomputed unsigned receipt digest

# Fixture Classes
Dev-only HMAC Fixtures
Dev-only HMAC fixtures use published test vectors committed in the manifest.
These are not credentials.
They exist only to make deterministic reproducibility tests possible.
They do not represent production signing.
KMS-style RSA Fixture
The KMS-style RSA fixture is signed locally with a throwaway RSA key using the RSASSA_PSS_SHA_256 verification path.
It is a local simulation only.
It is not AWS KMS evidence, not AWS-live validation, not hardware attestation, and not proof of key custody.
Tools

Run: 
npx ts-node tools/repro/verify-repro-manifest.ts \
  --manifest examples/reproducibility/manifest.json

Expected Result : "verdict: PASS"

Run the Integration Test : npx vitest run tests/integration/repro/receipt-reproducibility.test.ts

Independent Python Verifier

Ghost-Ark also includes a stdlib-only Python verifier skeleton:
python3 verifiers/python/ghost_receipt_verify.py \
  --receipt examples/reproducibility/receipts/hmac-baseline.receipt.json \
  --hmac-secret ghost-ark-repro-signing-dev-only-test-vector-v1

The Python verifier recomputes the receipt identity, digest, strict envelope checks, and dev-only HMAC signature without importing Ghost-Ark TypeScript.

Limitations:

* no RSA-PSS verification
* integer-only number canonicalization
* ASCII-only object keys
* no key manifest checks
* no chain completeness checks
* no checkpoint verification
* no tenant-expectation checks

Deterministic Report Contract

Reproducibility reports should be deterministic for the same committed fixtures.

They must include:

* schema version
* manifest path
* fixture count
* per-fixture checks
* final verdict
* explicit non-claim

Current Status

Current Spine B implementation status:

* reproducibility manifest exists
* expected digests exist
* TypeScript repro verifier exists
* integration test passes
* Python verifier smoke test passes
* malicious corpus test passes

Future Work

To reach a stronger independent-verifier level:

* add full Python RSA-PSS verification using a reviewed crypto dependency
* validate manifest shape against JSON Schema
* add key-manifest epoch checking
* add checkpoint/root verification
* add chain completeness checks
* add differential testing across TypeScript and Python for every fixture
