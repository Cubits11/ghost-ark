# Release Claims Boundary

Ghost Ark may claim only behavior that is implemented, tested, and bounded by explicit non-claims.

## Current Permitted Claims

- The repository contains an AWS evidence and receipt-control plane for tenant-scoped evidence artifacts.
- Evidence receipts are canonicalized and can be KMS-signed in the existing receipt path.
- The repository contains local deterministic enforcement-runtime primitives for policy decisions, memory gates, and decision receipts.
- Tenant identity for existing API receipt paths comes from JWT or authorizer context.
- Client-declared tenant, user, or session fields are rejected in receipt creation.
- Structured logging redacts prompt, completion, memory, raw body, and credential-like fields by default.

## Current Forbidden Claims

- Ghost Ark is a complete Amazon Bedrock enforcement runtime.
- Ghost Ark proves AI safety.
- Ghost Ark provides legal compliance.
- Ghost Ark provides clinical, emotional, therapeutic, or mental-health safety.
- Cryptographic receipts prove semantic correctness.
- Hashes prove safety.
- DynamoDB TTL gives immediate deletion.
- The current runtime is enterprise-ready or production-ready.

## Release Blockers For The North-Star Claim

- Wire policy evaluation around an actual Bedrock invocation path.
- Add tenant-scoped policy storage and retrieval.
- Add DynamoDB-backed privacy vault with explicit delete/export flows.
- Add KMS-backed decision receipt signing and verification.
- Add retrieval tenant and taint filtering before prompt construction.
- Add receipt-emission failure handling for every consequential response path.
- Scope or justify broad AWS IAM permissions.
