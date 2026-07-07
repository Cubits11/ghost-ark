# Receipt Protocol

Ghost Ark currently has two receipt families.

1. Evidence receipts: `ghost-ark.receipt.v1`, used by the existing evidence control plane.
2. Decision receipts: `ghost.receipt.v1`, added for the LLM enforcement-runtime slice.

## Decision Receipt Semantics

A decision receipt can show that:

- A decision envelope existed.
- A specific policy version and canonical policy hash were recorded.
- Input, tenant, user, session, and retrieval context digests were bound to the envelope.
- Pre-model and post-model decisions were recorded.
- Memory-write and consent state were recorded.
- The canonical unsigned envelope was signed.
- A previous signed receipt hash was recorded when chaining is used.

A decision receipt does not show that:

- The model output was correct.
- The policy was morally correct.
- The answer was safe.
- Legal compliance was achieved.
- No hidden context existed.

## Canonicalization

Decision receipts are signed over canonical JSON for the unsigned receipt envelope. The `receipt_signature` field is not part of the signing input. Verification recomputes:

- canonical receipt id,
- canonical digest,
- signature key id,
- canonical unsigned payload,
- signature validity,
- hash-chain continuity where a chain is supplied.

## Privacy

Decision receipts should contain digests, not raw prompts, completions, or memories. Low-entropy private identifiers should use HMAC digests rather than plain SHA-256.

## Signing Status

Decision receipt signing paths now include:

- `LOCAL_HMAC_SHA256_DEV_ONLY` for deterministic local tests.
- `KMS_SIGN_RSASSA_PSS_SHA_256` for AWS KMS-backed decision receipt signing.

Local HMAC verification remains implemented and tested. KMS verification for decision receipts is implemented with a public-key verifier for `KMS_SIGN_RSASSA_PSS_SHA_256`; unit tests use a generated RSA keypair and do not require live KMS. Evidence receipt KMS verification remains separate from decision receipt verification.

## Governed Invoke Emission

The governed invoke runtime attempts receipt emission for governed invocation attempts. If a model output exists and receipt emission fails, the runtime returns `failed_closed` and does not return the model output normally. Blocked pre-model paths still attempt a receipt; if that receipt fails, the response records the receipt failure but no model output was produced.

## AWS Digest Secret

Decision receipts use HMAC digests for low-entropy tenant, user, and session IDs. In AWS/KMS mode the digest secret must come from Secrets Manager or explicit deployment-time injection. CDK creates `ghost-ark-{stage}-decision-receipt-hmac-secret` and passes only `GHOST_ARK_RECEIPT_HMAC_SECRET_ARN` to the invoke Lambda.

## Non-Claims

Decision receipt verification proves only schema, canonical digest, key binding, and signature validity for the receipt envelope. It does not prove model correctness, safety, legal compliance, clinical or emotional safety, empirical truth, or production readiness.
