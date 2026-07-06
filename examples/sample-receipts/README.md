# Sample Receipts

Receipts are produced by `apps/api/src/handlers/createReceipt.ts` after canonicalization and AWS KMS signing. This directory is intentionally free of forged static signatures; use `examples/sample-evidence/` plus a dev KMS signing key to generate receipt fixtures.
