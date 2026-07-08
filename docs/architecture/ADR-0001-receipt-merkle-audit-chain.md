# ADR-0001: Receipt Merkle Audit Chain

Status: Accepted

## Context

Individual decision receipts are signed, but independent signatures do not prevent a storage administrator from presenting split views, omitting recent receipts, or reordering history. The receipt ledger therefore needs a tenant-local append chain plus periodic global checkpoints.

## Decision

Decision receipts include `prev_receipt_hash`, `execution_context_hash`, and `execution_nonce` inside the signed canonical payload.

Receipt persistence writes three DynamoDB records transactionally:

- The immutable receipt item.
- A request marker keyed by tenant and request id, storing a chain-independent request digest for idempotent replay detection.
- A tenant chain-head marker whose `headHash` is the canonical hash of the latest signed receipt.

The first receipt for a tenant must have `prev_receipt_hash = null`. Later receipts must point to the previous tenant chain head. If the head advances between signing and persistence, the emitter retries against the new head.

Periodic checkpoint workers aggregate all tenant chain heads into sorted Merkle leaves:

```text
leaf = sha256(canonical({ domain, tenantId, headHash }))
node = sha256("ghost-ark.receipt-checkpoint.node.v1:" + left + ":" + right)
```

The checkpoint root is signed with a dedicated epoch/checkpoint signing key, separate from the per-receipt signing key.

`createSignedEpochCheckpoint` is the checkpoint engine boundary: it reads the strongly consistent tenant chain heads from the decision receipt repository, signs the deterministic root, and stores the immutable checkpoint through the checkpoint repository. The operational entrypoint is `npm run receipt:checkpoint`, which uses `GHOST_ARK_DECISION_RECEIPT_TABLE`, `GHOST_ARK_RECEIPT_CHECKPOINT_TABLE`, and `GHOST_ARK_CHECKPOINT_SIGNING_KEY_ID` when explicit CLI flags are not supplied.

Offline chain verification fails closed for malformed receipts, empty chains, duplicate signed receipt hashes, cross-tenant links, and timestamp regressions before evaluating Merkle inclusion.

## Consequences

Auditors can verify receipt signatures, tenant-chain continuity, and inclusion in a signed global checkpoint. Exact request retries return the original receipt; same request id with different canonical content fails closed.
