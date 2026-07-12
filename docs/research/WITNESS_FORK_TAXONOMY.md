# Witness Fork Taxonomy and Detectability (Phase II)

Status: RESEARCH. This documents the classes of transparency-log fork the
authenticated revocation decision must survive, which are detectable offline,
and where enforcement currently stands. It is the failure taxonomy for the
`A_WITNESS_QUORUM_HONEST` assumption.

## Threat

`enforceAuthenticatedLedgerRevocation` reads order from witness-signed
checkpoints. A dishonest witness federation can attack that order by serving a
**fork** — two incompatible views of the same log. The question for each fork
class is: can a party holding the signed heads produce offline evidence, and does
the decision refuse to rely on a forked log?

## Classes

### F1 — Single-witness equivocation (same size, same witness)

One witness signs two different roots for the same `(log_id, tree_size)`.

- Evidence: `SplitViewFraudProof` (`detectSplitView`). Names the guilty key.
- Detectable offline: **yes**. Two signatures under one key over conflicting heads.
- Enforcement: the decision fails closed `rejected_equivocation` and returns the
  proof. **Enforced.**

### F2 — Federation split view (same size, disjoint signers)

Two different roots for the same `(log_id, tree_size)`, each reaching quorum, but
signed by disjoint witness sets — no single witness is individually guilty.

- Evidence: `FederationSplitViewProof` (`detectFederationSplitView`). Attribution
  is weaker (it blames the federation, not one key) but is still offline evidence
  that two quorum-signed histories exist.
- Detectable offline: **yes**, given both quorum-signed heads.
- Enforcement: the decision fails closed `rejected_equivocation` and returns the
  federation proof. **Enforced** (added this pass).

### F3 — History rewrite (different sizes, non-append-only)

Two quorum-signed checkpoints at sizes `n1 < n2` where the smaller is NOT a prefix
of the larger (the log rewrote committed history).

- Detectable offline from the two heads alone: **no** — roots are opaque; you
  cannot recompute a prefix relation without the tree data or a consistency proof.
- What IS enforced: the decision REQUIRES a valid Merkle consistency proof between
  its inclusion and revocation checkpoints. A rewrite between those two cannot
  produce a valid consistency proof, so it already fails `rejected_unprovable`.
- Residual gap: an F3 rewrite among checkpoints the decision is never shown is
  invisible to it. Catching that needs continuous external monitoring of the log,
  which is out of scope for a single decision.

## Completeness limit (why the assumption stays PARTIAL)

The decision can only reason about the checkpoints it is given (its two decision
heads plus the `observedCheckpoints` gossip pool). It detects F1 and F2 within
that set and rejects F3 that touches its own heads. It cannot detect a fork among
checkpoints outside the set — that is a gossip-completeness / liveness property of
the witness federation, not a property this function can establish alone. Hence
`A_WITNESS_QUORUM_HONEST` remains **PARTIAL** in the registry.

## Impossibility (honest boundary)

- No offline check can distinguish which side of a fork is canonical; a fraud
  proof shows equivocation, not which history is real.
- Absence of a fraud proof is not evidence of honesty — only that no fork was
  observed in the supplied set.

## Non-claim

This taxonomy and the associated detectors identify recorded forks in a supplied
checkpoint set and cause the decision to fail closed on them. They do not prove
the federation is honest, do not establish log liveness, and do not identify the
canonical history.
