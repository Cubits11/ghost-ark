# Witness Mechanism Design

## Status

Research doctrine with an executable fraud-proof primitive. This document is a
mechanism-design argument, not a deployed federation and not a claim of independent
transparency. Ghost-Ark does not yet operate independent witnesses; this file
describes the model and the enforcement artifact that would make one meaningful.

## One-sentence thesis

A transparency log is only as trustworthy as the cost of getting caught lying — so
the load-bearing artifact is not more cryptography inside one log, but a
self-contained fraud proof that any single honest observer can use to prove
equivocation.

## The unlearned lesson from Certificate Transparency

Ghost-Ark's Merkle checkpoints are RFC 6962-shaped and internally correct. But a log
that is the sole witness to its own tree can serve one root to an auditor and a
different root to a user for the same tree size — a split view. Each view is
internally consistent, so no local correctness check detects it. Object Lock in
GOVERNANCE mode does not close this: a principal with the bypass permission can
rewrite. Without independent witnesses and gossip, the transparency layer is
decorative.

## The enforcement primitive: single-witness split-view fraud proofs

If a **single** witness signs two checkpoints that assert the same
`(log_id, tree_size)` but different `root_hash`, that pair is offline-verifiable
evidence — under the witness's own key — that the log equivocated. The proof is
self-contained: a checker needs only the two signed heads and the witness key
manifest. It does not need to trust the log, the operator, or a third party.

### Scope and assumptions (deliberately narrow)

- **Single-witness only.** The motivating "auditor sees one root, user sees another"
  scenario is detected by this primitive *only when the same witness co-signs both
  views*. If the operator partitions witnesses across views (disjoint signer sets),
  the primitive returns null. Cross-witness split views are an open problem, not a
  covered case.
- **Same tree size only.** A fork at different tree sizes is a non-append-only
  rewrite that surfaces as a *broken consistency proof*, not as this fraud proof.
  It is deferred to Open problems.
- **`log_id` names one append-only incarnation.** Reusing a `log_id` across a reset
  or re-initialization is itself a governance violation and is out of scope. Under
  this assumption, two heads at the same `(log_id, tree_size)` with different roots
  are equivocation regardless of their `integrated_time` — an append-only tree of
  size N has exactly one root, forever.

`packages/research-frontier/src/witnessFraudProof.ts` implements:

- `detectSplitView` — scans a set of signed checkpoints and emits a fraud proof if a
  witness equivocated;
- `verifySplitViewFraudProof` — independently confirms a fraud proof: same log, same
  tree size, differing roots, and a valid witness signature on both heads.

Tests in `tests/unit/research-frontier/witnessFraudProof.test.ts` show detection of a
genuine equivocation, offline verification, rejection of a forged proof whose
signatures do not verify, and rejection of a "proof" whose two heads are identical.

## Why honest signing is the incentive-compatible strategy

Model a permissioned federation of N organizations, each running a witness that
co-signs Signed Tree Heads and a monitor that checks consistency proofs between heads
it receives. Adopt a single federation rule: **a validly-signed equivocation ⇒
ejection** (and whatever external consequences the federation attaches to ejection).

- The cost of equivocating is bounded below by the value of continued membership,
  because a fraud proof is permanent and publicly checkable.
- Detection does not require a majority. It requires at least **one** honest party
  to hold a conflicting head **and** gossip reachability such that both conflicting
  heads converge at a common verifier — a single honest holder whose gossip never
  reaches a party holding the other head produces no proof. So the load-bearing
  assumption is honest-party existence *plus* topology reachability.
- Therefore, for any witness whose membership is worth more than a single successful
  equivocation, honest signing dominates **for the equivocation shape this primitive
  detects** (same witness, same tree size). A rational adversary that partitions
  witnesses or forks at different tree sizes evades the current detector; those cases
  are open problems below, and the deterrent does not yet bind them.

This is a mechanism-design argument, not a live claim. Its assumptions are explicit:
at least one honest gossiping party with reachability to a holder of the conflicting
head, an out-of-band ejection consequence, witness key manifests that bind
identities, and `log_id` non-reuse.

## Why not a cryptoeconomic / token layer

The enterprise-governance setting does not need an on-chain incentive market. The
independence that matters is organizational, not economic: N separate risk
departments or external auditors, each holding heads the others cannot silently
alter. A minimal near-term step is to publish Signed Tree Heads to an external
append-only log the project already touches, which alone breaks unilateral split-view
for the checkpoint roots.

## Non-claims

- A valid fraud proof demonstrates equivocation by the named witness for the recorded
  heads. It does not establish which view is canonical, that any decision in either
  tree was correct, or that a federation is live.
- Absence of a fraud proof is not evidence of honesty; it is only evidence about the
  heads a given observer happens to hold.
- A maintainer-controlled witness is not independent. Independence is an assumption
  this document states, not a property this repository currently provides.

## Open problems

- A gossip protocol and monitor onboarding for the permissioned federation.
- Consistency-violation fraud proofs (a broken consistency proof between two validly
  signed heads as evidence of a non-append-only rewrite).
- Binding federation membership consequences to something an operator cannot
  unilaterally reverse.

Related: [[temporal-trust-model]], [[claim-entailment-model]].
