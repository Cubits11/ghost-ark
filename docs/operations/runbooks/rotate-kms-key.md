# Rotate KMS Signing Key

KMS asymmetric signing keys do not rotate transparently like symmetric encryption keys. Rotation is a controlled key succession event.

This runbook is an operator procedure, not evidence that a live rotation has occurred. Every AWS mutation below requires an approved, bounded AWS window.

## Preconditions

1. Record the change/incident identifier, account, region, tenant scope, current immutable key ARN, manifest digest, and rollback owner.
2. Confirm the evidence window, cost limit, and cleanup owner.
3. Export a sanitized pre-change manifest and verification report. Never capture private key material, credentials, or unredacted tenant identifiers.

## Planned succession

1. Create a new asymmetric `SIGN_VERIFY` key with the approved key policy.
2. Publish its immutable key ARN, public key, algorithm, `validFrom`, and fingerprint as an `ACTIVE` entry.
3. Change the old entry to `DEPRECATED` (verifying-only) and set a non-overlapping `validUntil`.
4. Run the local signing-authorization check: the old entry must fail and the new entry must pass.
5. Update signer configuration for new receipts only. Do not use a mutable alias as receipt identity.
6. Issue a key-succession ledger event signed by the prior active key when policy permits.
7. Verify one pre-rotation receipt with the old public key and one post-rotation receipt with the new public key.
8. Attempt a controlled old-key signing request and preserve the denial evidence.
9. Publish the new manifest digest and retain the prior manifest snapshot.

## Suspected compromise

1. Disable application access to the affected key and begin the incident workflow.
2. Set the old manifest entry to `REVOKED` with the earliest defensible `revokedAt`; do not rewrite older manifests.
3. Activate a separately reviewed successor key.
4. Verify that receipts at or after `revokedAt` fail the key-epoch check even when their signature bytes are valid.
5. Inventory receipts from the suspected exposure window and link them to the incident record.

## Closeout evidence

- Before/after manifest digests and immutable key IDs.
- Old-key historical verification PASS and old-key new-signing denial.
- New-key signing and verification result.
- KMS/CloudTrail excerpts sanitized to exclude account-sensitive or tenant-sensitive data.
- Rollback decision and incident/change linkage.

Local unit tests cover lifecycle decisions. They do not prove live KMS key-policy behavior, IAM denial, CloudTrail capture, or successful operational rotation.
