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

The v1 manifest represents the four operational lifecycle states without changing historical artifact vocabulary:

| Operational state | v1 representation | New signing | Historical verification |
|---|---|---:|---:|
| Active | `status: ACTIVE` inside its epoch | Allowed by `verifyKeyManifestSigningAuthorization` | Allowed |
| Verifying-only | `status: DEPRECATED` before `validUntil` | Rejected | Allowed inside the epoch |
| Retired | Any entry at or after `validUntil` | Rejected | Rejected at or after the epoch boundary; earlier receipts remain eligible |
| Compromised | `status: REVOKED` with `revokedAt` | Rejected | Eligible only before `revokedAt`; a missing `revokedAt` fails all verification |

This mapping preserves compatibility with existing `ghost.key_manifest.v1` artifacts while making the signer/verifier distinction explicit. A caller must not use receipt verification eligibility as signing authorization.

Manifest validation also rejects duplicate `(keyId, algorithm)` entries, `validUntil` values that do not come after `validFrom`, and `revokedAt` values earlier than `validFrom`. Verification treats an invalid manifest as a failed check rather than continuing with ambiguous key lifecycle state.

The runtime primitive `verifyKeyManifestSigningAuthorization` fails closed on an invalid manifest, missing key, algorithm mismatch, invalid signing time, out-of-window epoch, deprecated key, or revoked key. Only `ACTIVE` keys are eligible for new signing. Live KMS configuration must wire this decision into the signer-selection path before any signing call; local tests demonstrate the policy primitive but do not evidence deployed KMS rotation.

## Consequences

Offline verifiers can use the manifest to select a public key and enforce lifecycle policy. Historical receipts remain valid when their timestamp predates revocation; post-revocation receipts fail even if their cryptographic signature still verifies.

## Compromise response

1. Stop new signing with the affected immutable key ID; do not rely on an alias update alone.
2. Record the earliest defensible `revokedAt` instant and publish a new manifest snapshot with `status: REVOKED`.
3. Create a successor key entry with a non-overlapping signing authorization decision and `status: ACTIVE`.
4. Re-verify receipts on both sides of the boundary: pre-revocation historical receipts may pass, while receipts at or after `revokedAt` must fail.
5. Preserve the old public key and manifest history for review; never delete the verification context to conceal the event.
6. Link the change record and affected receipt range to an incident artifact.

Whether an older receipt should also be distrusted for operational reasons is an incident-policy decision outside cryptographic verification. The verifier reports the recorded epoch binding; it does not establish when a compromise actually began.
