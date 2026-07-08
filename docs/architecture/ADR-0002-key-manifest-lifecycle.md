# ADR-0002: Key Manifest Lifecycle

Status: Accepted

## Context

Receipts must remain verifiable across signing-key rotation without trusting mutable aliases or hardcoded verifier keys. Emergency revocation must reject receipts signed after revocation while preserving historical receipts signed before the revocation time.

## Decision

Ghost Ark uses `ghost.key_manifest.v1`, defined in `schemas/key-manifest.json`, as the verifier-facing key transparency manifest. Each entry maps an immutable `keyId` and signing algorithm to a validity interval:

- `validFrom`
- optional `validUntil`
- `status: ACTIVE | DEPRECATED | REVOKED`
- optional `revokedAt`
- optional `publicKeyPem` for offline verification

Verification succeeds only when the receipt execution timestamp is at or after `validFrom`, before `validUntil` when present, and before `revokedAt` when the key is revoked. A revoked key without `revokedAt` rejects all receipts.

## Consequences

Offline verifiers can use the manifest to select a public key and enforce lifecycle policy. Historical receipts remain valid when their timestamp predates revocation; post-revocation receipts fail even if their cryptographic signature still verifies.
