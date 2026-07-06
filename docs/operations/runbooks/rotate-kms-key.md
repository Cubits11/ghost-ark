# Rotate KMS Signing Key

KMS asymmetric signing keys do not rotate transparently like symmetric encryption keys. Rotation is a controlled key succession event.

1. Create a new asymmetric `SIGN_VERIFY` key.
2. Publish the new key ID and public key fingerprint in the control-plane registry.
3. Update signer configuration for new receipts only.
4. Keep old public keys available for historical verification.
5. Issue a key succession ledger event signed by the prior active key when possible.
6. Run verification checks against a historical receipt sample before closing the change.
