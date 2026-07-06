# Receipt Lifecycle

1. Evidence arrives in a tenant raw namespace.
2. Ingest handlers extract object metadata, classify the source type, and emit a lineage event.
3. Glue or Lambda transforms create curated datasets with deterministic partition fields.
4. The catalog is refreshed and Athena validates the curated result.
5. A receipt payload is built from evidence references, transform metadata, governance context, claim references, and lineage pointers.
6. The payload is canonicalized, hashed with SHA-256, and signed by AWS KMS using an asymmetric signing key.
7. Receipt state, signature metadata, and lineage pointers are written to DynamoDB with conditional idempotency.
8. OpenSearch receives a disclosure-safe index document.
9. API and console clients retrieve the receipt, verify signature state, and assemble evidence packs.

Receipts can be superseded, revoked, or disputed. They are not deleted from the ledger during normal operations.
