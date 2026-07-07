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
- signature validity,
- hash-chain continuity where a chain is supplied.

## Privacy

Decision receipts should contain digests, not raw prompts, completions, or memories. Low-entropy private identifiers should use HMAC digests rather than plain SHA-256.

## Signing Status

The current decision receipt signer is `LOCAL_HMAC_SHA256_DEV_ONLY` for local tests. Production decision receipts require a KMS-backed signer and verifier before the runtime can claim AWS-native signing for LLM decisions.
