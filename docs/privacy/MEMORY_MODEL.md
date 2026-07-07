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
- `REQUIRE_CONSENT`, `REFUSE`, `SILENCE`, `ESCALATE`, and `HUMAN_REVIEW` prevent runtime memory persistence.
- `RESTRICTED` requires consent state `granted`.
- `SESSION` requires `expiresAt`.
- `KAPPA` is never written.
- The governed invoke runtime records `memory_written` in the decision receipt.
- The governed invoke request schema accepts `contentDigest` for memory writes. This pass does not store raw memory content in the vault.

## TTL Semantics

DynamoDB TTL, when used, is only a storage cleanup backstop. It is not immediate deletion. Runtime reads must filter expired records before returning them, even if the backing item still exists.

## Deletion and Export

- Erasable user-visible memory can be exported.
- Erasable non-audit records can be deleted.
- Audit records are tombstoned to preserve minimized decision history.

## Current Status

The repository contains:

- A local in-memory vault implementation and tests for suppression, TTL filtering, consent, delete, and export behavior.
- A DynamoDB-backed vault implementation that partitions by tenant and user, stores content digests rather than raw memory content, rejects KAPPA persistence, requires SESSION expiry, filters expired records at read time, and tombstones AUDIT records.
- CDK wiring for a `ghost-ark-{stage}-privacy-vault` table with on-demand billing, TTL on `expiresAtEpoch`, and point-in-time recovery.

Live AWS validation of the DynamoDB vault path is still required before production claims. The AWS governed invoke smoke should include a memory-write case before any production readiness claim.
