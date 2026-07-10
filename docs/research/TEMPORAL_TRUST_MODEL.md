# Temporal Trust Model

## Status

Research doctrine with executable primitives. This document describes how Ghost-Ark
reasons about time and evidentiary aging. It is not a certification claim, a legal
analysis, or a completed formal proof. Each primitive is bounded by the non-claims
stated at the end of its section.

## One-sentence thesis

Trust over time is an *order* relation the signer cannot set, not a *duration* the
signer asserts — and evidentiary aging is a monotone descent over discrete, cited
events, not a continuous probability that decays.

## Problem 1 — revocation anchored to the signer's clock

The v1 key-manifest epoch check evaluates a key's revocation window against
`receipt.timestamp`. That timestamp is the one field the signer supplies. A holder
of a since-revoked key can mint a fresh receipt, stamp a time earlier than
`revokedAt`, and pass the check. The security question "was this signed before the
key was revoked?" is being answered with data the adversary controls.

### The distinction that matters

Backdating forges a **duration** claim ("this happened before revocation"). The
defense must replace it with an **order** claim the signer cannot forge:

- A receipt's chain-head leaf is *included* in an append-only checkpoint at a ledger
  index assigned by the log.
- The revocation is *recorded* at a checkpoint index of its own.
- The receipt is admissible iff its inclusion index is strictly less than the
  revocation index.

Inclusion position is not a value the signer writes; it is the log's answer to
"when did this first appear?" Merkle append-only structure plus consistency proofs
make retroactive insertion detectable, so the order cannot be rewritten after the
fact without breaking a proof.

A Verifiable Delay Function is the wrong instrument here: a VDF attests *elapsed
time* (a duration). The threat is *sequence*. What is needed is the log's order,
which the checkpoint ledger already provides.

### Executable primitive

`packages/enforcement-runtime/src/receipts/ledgerAnchoredRevocation.ts`

`enforceLedgerAnchoredRevocation` decides `valid_pre_revocation` /
`rejected_post_revocation` / `rejected_unprovable` purely from ledger indices and a
verified Merkle inclusion proof. It never consumes `receipt.timestamp` for the
decision; it accepts it only to *label* a clock-vs-ledger contradiction as
`backdatingSuspected`. Tests in
`tests/unit/enforcement-runtime/receipts/test_ledgerAnchoredRevocation.test.ts`
show the fixture-C backdating attack rejected and flagged, and show that a
backdated timestamp cannot change the verdict.

### Non-claims

- A `valid_pre_revocation` verdict is only as strong as the append-only property of
  the supplied checkpoint sequence. It does not establish key custody.
- It does not prove the recorded decision was correct or that the ledger is
  independently witnessed. Independent witnessing is a separate concern; see
  [[witness-mechanism-design]].

## Problem 2 — evidentiary aging

A receipt that verified today is often treated as a permanent pass. But keys leak,
policies are superseded, and infrastructure drifts. The naive fix — a continuous
"confidence" score `P(valid | Δt)` that decays — is unsound for this project:

- there is no generative model behind the decay coefficient;
- the coefficient is unfalsifiable;
- it breaks reproducibility, because the same receipt bytes would score differently
  on a later read.

A soothing or alarming number that no one can recompute is exactly the
confidence-without-truth failure Ghost-Ark exists to avoid.

### The reproducible formalization

Evidentiary standing is a position on a totally ordered lattice:

```
current  <  stale  <  policy_superseded  <  drift_observed  <  key_revoked  <  withdrawn
```

Standing only ever descends, and only via a discrete event that carries a `reason`
and a provenance `source`. Freshness is measured in **ledger-epoch lag**, not
wall-clock seconds, so the verdict is a pure function of cited inputs and does not
drift with the reader's clock. "Evidentiary half-life" is a metaphor; the honest
formalization is monotone lattice descent under a provenance-cited event log.

### Executable primitive

`packages/research-frontier/src/evidenceStaleness.ts`

`evaluateEvidenceStanding` returns the worst standing reached plus the ordered trail
of applied downgrades. It is deterministic and order-independent, verified by
`tests/unit/research-frontier/evidenceStaleness.test.ts`.

### Non-claims

- A standing is a discrete lattice position derived from cited events. It is not a
  probability, a confidence score, or a prediction of reliability.
- Absence of a downgrade event is not evidence that the underlying decision was
  sound.

## Open problems

- Binding revocation epochs to an external anchor (for example an independent
  transparency log) so operator collusion cannot rewrite the order.
- A principled maximum epoch lag per evidence class, rather than a fixed constant.
- Composition: how the ledger-order verdict and the staleness lattice combine into a
  single admissibility decision for a downstream consumer.
