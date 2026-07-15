# Evidence Provenance Lattice

Status: research-only. Local implementation with unit tests. Not wired into receipt v1 emission. Not model-checked. Not a proof about any AWS deployment.

## Purpose

Ghost-Ark receipts bind decisions to evidence digests. Assertion-Conditioned Compliance (A-CC) attacks exploit the gap this leaves open: a structurally valid evidence set can be functionally adversarial, and no deterministic function of adversary-controlled bytes can distinguish honest from dishonest content.

The provenance lattice is the bounded response. Instead of asking the verifier to detect lies (which it cannot), every evidence element is labeled with a provenance class that records **who must be compromised to fabricate it** under stated assumptions. Policy then conditions effects on provenance floors, not on evidence content alone.

A provenance class describes forgery-cost structure. It does not describe truth.

## Definitions

An evidence element is a tuple:

- `evidenceId` — identifier
- `contentDigest` — `sha256:<hex>` commitment to the evidence bytes
- `sourceId` — the origin the element is attributed to
- `provenanceClass` — the label defined below

Labels are assigned by enforcement-boundary code (the gateway, the receipt emitter, a delegation admission check). The agent whose conduct is being governed never assigns its own labels. This assignment authority is the load-bearing rule; the lattice math is secondary to it.

## Classes and Order (v1)

The v1 order is a total chain. Every chain is a lattice; join is max and meet is min.

| Rank | Class | To fabricate an element of this class, the adversary must control... |
| --- | --- | --- |
| 0 | `AGENT_ASSERTED` | only the agent. The agent said so; nothing else vouches. |
| 1 | `GATEWAY_RECORDED` | the enforcement boundary itself. The gateway observed and digested the event in transit. |
| 2 | `SOURCE_SIGNED` | the origin's signing key (and the boundary, for the binding). The origin signed the content. |
| 3 | `CROSS_WITNESSED` | at least two independent sources at `SOURCE_SIGNED` or above whose records agree on one content digest. Derive-only. |
| 4 | `EXTERNALLY_ATTESTED` | the above plus an external attestation mechanism for the execution environment. Aspirational in this repository; no attestation flow is claimed as implemented for this class. |

Design decisions, stated as decisions rather than facts:

1. The chain ordering of `SOURCE_SIGNED` above `GATEWAY_RECORDED` reflects this pipeline's architecture, where all evidence transits the gateway, so a source signature adds origin authentication on top of transit recording. In an architecture without a mandatory gateway these would be incomparable and the order would need to become a genuine partial order.
2. Ranking `CROSS_WITNESSED` below `EXTERNALLY_ATTESTED` assumes witness independence. Correlated witnesses weaken rank 3 in ways this v1 chain does not model; measuring that correlation is CC-Framework territory, and a correlation-adjusted ordering is future work.
3. `CROSS_WITNESSED` is **derive-only**: it may never be assigned to a single element. It is computed from agreeing independent records by `deriveAggregateClass`. This prevents an agent (or a single tool) from labeling its own output as corroborated.

## Implementation

`packages/enforcement-runtime/src/evidence/provenanceLattice.ts` implements:

- `assertProvenanceClass` / `assertAssignableProvenanceClass` — unknown labels and direct assignment of derive-only classes are rejected (fail closed)
- `joinProvenance` / `meetProvenance` / `compareProvenance` — lattice operations
- `evaluateEvidenceFloor(elements, requirement)` — floor checking with distinct-source counting
- `deriveAggregateClass(elements)` — cross-witness derivation over agreeing digests
- `admitDelegatedEvidence({claimedClass, reverifiedClass})` — delegation admission at the meet
- `detectVacuousRequirement(requirement)` — static policy lint

Tests: `tests/unit/enforcement-runtime/evidence/provenanceLattice.test.ts`.

Schema: `schemas/ghost_evidence_provenance.v1.json`.

## Stated Properties

These are stated properties of the local implementation with proof sketches. They are checked by unit tests over the finite class set. They are not machine-checked proofs, and they say nothing about any deployment.

### P1 — Verdict monotonicity under provenance stratification

Statement: for a requirement with floor `f`, adding elements with class below `f` to an evidence set never changes the evaluation from unsatisfied to satisfied.

Sketch: `evaluateEvidenceFloor` filters to elements meeting the floor before counting distinct sources. Below-floor elements never enter the qualifying set, so the count is unchanged by their addition. Tested by flooding an unsatisfied set with 50 `AGENT_ASSERTED` elements.

Consequence: an adversary who controls only below-floor classes cannot move a verdict by volume. Corrupting low-class evidence can degrade nothing and authorize nothing beyond what high-class evidence already supports.

### P2 — No laundering across delegation

Statement: the admitted class of delegated evidence never exceeds the claimed class, and never exceeds what the receiving boundary independently re-verified. Provenance rank is non-increasing across delegation hops.

Sketch: `admitDelegatedEvidence` returns the meet of the two inputs; the meet in a chain is the minimum, which is bounded by both arguments. Tested over all class pairs.

Consequence: a chain of agents cannot upgrade an assertion into corroborated evidence by passing it around. If Agent B's boundary can only re-verify Agent A's material as `AGENT_ASSERTED`, that is what it admits, regardless of the class A claimed.

### P3 — Derivation discipline for cross-witnessing

Statement: `CROSS_WITNESSED` arises only from at least two distinct `sourceId`s at `SOURCE_SIGNED` or above committing to the identical content digest, and can never be carried by a single element.

Sketch: `assertAssignableProvenanceClass` rejects it on input paths; `deriveAggregateClass` requires digest agreement and counts distinct signed sources. Tested for the upgrade case, the repeated-source case, and the agreeing-agent-assertions case (no upgrade).

### P4 — Fail-closed label handling

Statement: an unrecognized provenance label is never interpreted as any rank; it raises a `ValidationError`.

Sketch: rank lookup asserts membership before use. Tested with unknown strings.

## Impossibility Statement (I2)

For evidence sets whose every element is producible by the adversary, no deterministic verification function over the evidence bytes alone separates honest from adversarial sets: the adversary can produce any byte string an honest party can. This is the evidence-side sibling of the cognitive-contamination impossibility. The lattice does not evade I2; it responds to it by requiring floors the adversary cannot reach without widening the compromise (gateway key custody, source key custody, multiple independent sources), and by making a vacuous floor — one satisfiable by agent-synthesized evidence alone — a statically detectable policy defect (`detectVacuousRequirement`).

## A-CC Decomposition

The lattice splits Assertion-Conditioned Compliance into two components with different statuses:

1. **Assertion-vs-record divergence** — the agent's claim about what a tool returned differs from what the boundary recorded (`GATEWAY_RECORDED` digest). Deterministically detectable by comparing the two views at the boundary. This component is catchable, and the pipeline should catch it.
2. **Record-vs-world divergence** — the tool itself reported a falsehood; the record faithfully preserves the lie. Not detectable from the record alone (I2). Bounded only by sourcing structure: raising the floor to `CROSS_WITNESSED` raises the attack cost from one compromised source to several, with residual risk from correlated witness failure.

GhostBench should measure the two components separately. Conflating them makes containment numbers unintelligible.

## Non-Claims

- A provenance class does not state that evidence content is true.
- The lattice does not detect semantic falsehood in source-reported content (I2 above).
- Nothing here is a machine-checked proof; properties P1–P4 are unit-tested statements about local TypeScript code.
- `EXTERNALLY_ATTESTED` names a class in the order; no attestation flow is claimed as implemented for it.
- This module is not connected to receipt v1 emission; binding labels into receipts requires a receipt schema migration (see ACC_DEFENSE_INQUIRIES.md, Inquiry 9 artifact note).
- No claim is made about AWS services, deployments, or live cloud behavior.

## Maturity

Per docs/research/ASSURANCE_MATURITY_LADDER.md: documented design with a unit-tested local implementation. Below model-checked. Far below proof-backed.
