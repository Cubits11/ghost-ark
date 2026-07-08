# Runtime Attestation Binding

Phase 5 introduces runtime attestation binding for receipts and epoch checkpoints.

Runtime attestation binding allows Ghost-Ark to verify that a receipt or checkpoint is associated with an attestation evidence object satisfying a declared runtime policy.

## What It Does

- Defines `ghost.runtime_attestation.v1`.
- Computes a domain-separated canonical subject digest with the shared canonical JSON utility.
- Verifies declared runtime identity fields: runtime id, image digest, code digest, and policy compiler digest.
- Verifies binding to at least one receipt hash, checkpoint digest, or payload digest.
- Provides a local-dev HMAC backend for deterministic tests and CLI behavior.
- Supports sidecar bundles such as `ghost.attested_receipt_bundle.v1` and `ghost.attested_checkpoint_bundle.v1`.

## What It Does Not Claim

- It does not prove the model output is safe.
- It does not prove deployment safety.
- It does not prove production Nitro Enclave isolation.
- It does not prove complete AWS root compromise immunity.
- It is not production compliance certification.

AWS Nitro Enclave evidence is schema-reserved only in this phase. Nitro evidence fails closed until live attestation document validation is implemented and tested.

## Threat Model

The verifier checks whether supplied attestation evidence is internally consistent with a declared runtime policy. It is designed to catch malformed evidence, tampered subject digests, unsupported attestation types, missing bindings, wrong runtime identity, and signature failures.

The local-dev attester is for deterministic development tests only. Its HMAC secret is not an enclave root of trust.

## Failure Modes

The verifier returns `FAIL` for malformed schemas, unknown fields, subject digest mismatch, missing required bindings, expected digest mismatch, disallowed runtime ids or digests, signature mismatch, unsupported attestation types, and Nitro evidence without a Nitro verifier.

## CLI

```bash
node tools/ghost-verify.mjs \
  --runtime-attestation attestation.json \
  --attestation-policy policy.json \
  --attestation-secret "$GHOST_ARK_LOCAL_ATTESTATION_SECRET"
```

```bash
node tools/ghost-verify.mjs \
  --attested-receipt-bundle bundle.json \
  --attestation-policy policy.json \
  --attestation-secret "$GHOST_ARK_LOCAL_ATTESTATION_SECRET"
```

## Adversarial Examples

- Change `subjectDigest` after issuance: `FAIL`.
- Change the expected receipt hash: `FAIL`.
- Remove a binding required by policy: `FAIL`.
- Use `aws-nitro-enclave` without a real Nitro verifier: `FAIL`.

A PASS verdict means internal consistency under Ghost-Ark verifier rules for the supplied artifacts. It is not a safety certification, compliance certification, or proof of deployment correctness.
