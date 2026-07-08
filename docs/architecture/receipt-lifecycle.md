# Receipt Lifecycle

1. Evidence arrives in a tenant raw namespace.
2. Ingest handlers extract object metadata, classify the source type, and emit a lineage event.
3. Glue or Lambda transforms create curated datasets with deterministic partition fields.
4. The catalog is refreshed and Athena validates the curated result.
5. A receipt payload is built from evidence references, transform metadata, governance context, claim references, and lineage pointers.
6. The payload is canonicalized, hashed with SHA-256, chained to the previous tenant receipt head, and signed by AWS KMS using an asymmetric signing key.
7. Receipt state, signature metadata, request idempotency markers, and tenant chain-head markers are written to DynamoDB with conditional transactional idempotency.
8. OpenSearch receives a disclosure-safe index document.
9. Periodic checkpoint workers aggregate tenant chain heads into a signed Merkle root.
10. API and console clients retrieve the receipt, verify signature state, chain continuity, checkpoint inclusion, and assemble evidence packs.

Receipts can be superseded, revoked, or disputed. They are not deleted from the ledger during normal operations.

See also:

- [ADR-0001: Receipt Merkle Audit Chain](./ADR-0001-receipt-merkle-audit-chain.md)
- [ADR-0002: Key Manifest Lifecycle](./ADR-0002-key-manifest-lifecycle.md)
- [ADR-0003: Policy Invariant Verification](./ADR-0003-policy-invariant-verification.md)
