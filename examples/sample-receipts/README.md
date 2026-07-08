# Sample Receipts

Receipts are produced by `apps/api/src/handlers/createReceipt.ts` after canonicalization and AWS KMS signing.

This directory contains one local verification fixture:

- `valid-receipt.json`: a sample receipt record with a KMS-shaped RSA-PSS signature envelope.
- `public-key.pem`: the public key that verifies the sample receipt signature.

Run the offline verifier without AWS credentials:

```bash
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
```

The fixture proves the local verifier path only. It is not live AWS evidence and does not prove evidence truth, AI safety, compliance, production readiness, or deployment safety.
