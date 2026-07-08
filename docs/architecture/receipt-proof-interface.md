# Receipt Proof Interface

Phase 6 introduces a receipt proof statement interface and a deterministic local transcript backend.

The local transcript backend is not a zero-knowledge proof system. It exists to stabilize statement hashing, public inputs, proof verification interfaces, and CLI behavior before a real proving backend is integrated.

## What It Does

- Defines `ghost.receipt_proof_statement.v1`.
- Defines `ghost.receipt_proof.v1`.
- Computes a domain-separated statement digest over public inputs and claims only.
- Provides a local transcript backend with deterministic transcript hashing for tests.
- Reserves proof-system identifiers for future `risc0`, `sp1`, `halo2`, `noir`, and `circom` integrations.
- Requires reserved proof systems to carry strict base64 `proofBytesBase64`.
- Rejects reserved proof artifacts that leak local transcript witness metadata such as `transcriptWitnessDigest`, `devOnly`, or `notZeroKnowledge`.
- Provides a `ReceiptProofBackendVerifier` interface and `ExternalReceiptProofVerifier` adapter for attaching a zkVM/SNARK verifier process.

## What It Does Not Claim

- Ghost-Ark does not now have production ZK proofs.
- The local transcript backend is not privacy-preserving.
- The private proof bundle is a development harness and must not be shared with external auditors when privacy is required.
- A PASS verdict does not prove model safety, deployment correctness, or compliance.

## Threat Model

The interface catches tampered public inputs, tampered statement digests, malformed hashes, missing local transcript digests, unsupported proof systems, and proof systems disallowed by the verifier configuration.

It does not hide witness data in the local backend. The backend metadata intentionally carries a dev-only witness digest so deterministic tests can recompute the transcript.

Reserved proof systems can only pass when an explicit backend verifier is supplied by the caller. The bundled verifier does not implement RISC Zero, SP1, Halo2, Noir, or Circom cryptographic proof verification.

## CLI

```bash
node tools/ghost-verify.mjs --receipt-proof receipt-proof.json
```

```bash
npm run receipt-proof:local -- \
  --chain chain.json \
  --checkpoint checkpoint.json \
  --inclusion-proof proof.json \
  --key-manifest key-manifest.json \
  --out receipt-proof.json
```

## Adversarial Examples

- Change `publicInputs.merkleRoot`: `FAIL`.
- Set `receiptCount` to zero: `FAIL`.
- Use `halo2` before a verifier exists: `FAIL`.
- Remove `proof.transcriptDigest` from a local transcript proof: `FAIL`.
- Attach local transcript witness metadata to a reserved ZK proof: `FAIL`.
- Provide malformed reserved-backend proof bytes: `FAIL`.

A PASS verdict means internal consistency under Ghost-Ark verifier rules for the supplied proof artifact. It is not proof of production zero-knowledge privacy.
