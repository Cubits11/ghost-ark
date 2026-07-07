# Memory Model

Ghost Ark treats memory as a policy-controlled privacy vault, not as an unbounded transcript store.

## Tiers

- KAPPA: invocation-only memory. It is never persisted.
- SESSION: short-lived memory. It must have an expiration timestamp, and reads ignore expired records immediately.
- CONSTITUTION: persistent user preferences and policy material.
- AUDIT: minimized metadata and receipt events. Normal delete requests tombstone rather than erase audit records.
- RESTRICTED: opt-in memory that requires explicit consent before write.

## Write Gate

A memory write is allowed only after policy evaluation.

- `MEMORY_SUPPRESS` prevents persistence.
- `RESTRICTED` requires consent state `granted`.
- `SESSION` requires `expiresAt`.
- `KAPPA` is never written.

## TTL Semantics

DynamoDB TTL, when used, is only a storage cleanup backstop. It is not immediate deletion. Runtime reads must filter expired records before returning them, even if the backing item still exists.

## Deletion and Export

- Erasable user-visible memory can be exported.
- Erasable non-audit records can be deleted.
- Audit records are tombstoned to preserve minimized decision history.

## Current Status

The repository contains a local in-memory vault implementation and tests for suppression, TTL filtering, consent, delete, and export behavior. It is not yet a DynamoDB-backed production privacy vault.
