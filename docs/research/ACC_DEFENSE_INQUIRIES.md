# A-CC Defense Inquiries

Date: 2026-07-14. Status: research-only. This document answers ten doctoral-defense inquiries on Assertion-Conditioned Compliance (A-CC): the failure mode where an agent incorporates a false assertion — often a Function-Sourced Assertion (FSA) from a compromised or deceptive tool — into procedurally valid execution, so the pipeline signs a structurally flawless record of a functionally corrupted operation.

## Position

Three commitments run through every answer:

1. **No deterministic evaluator over adversary-produced bytes separates honest from adversarial content.** This is Impossibility Statement I2 in docs/research/EVIDENCE_PROVENANCE_LATTICE.md. Any design that pretends otherwise is unsound.
2. **The response to I2 is sourcing structure, not smarter checking.** Policy floors are expressed over provenance classes — labels recording who must be compromised to fabricate the evidence — assigned by boundary code, never by the agent.
3. **A receipt is evidence against the signer, not endorsement of the payload.** A signed record of a compromised execution is the artifact that makes the compromise measurable, attributable, and non-repudiable.

Supporting artifacts: `packages/enforcement-runtime/src/evidence/provenanceLattice.ts` (implementation), `tests/unit/enforcement-runtime/evidence/provenanceLattice.test.ts` (tests), `schemas/ghost_evidence_provenance.v1.json` (schema), docs/research/EVIDENCE_PROVENANCE_LATTICE.md (properties P1–P4, I2, A-CC decomposition).

---

## Inquiry 1 — Epistemology of the Evidence Lattice

*What property makes the commit predicate evaluate provenance integrity rather than rubber-stamping syntactic validity?*

No lattice property makes a predicate evaluate truth; that demand runs into I2. The property that does real work is **verdict monotonicity under provenance stratification** (P1): the commit predicate is stratified so each effect class names a provenance floor, elements below the floor never enter the qualifying set, and therefore no volume of low-class evidence can move a verdict. The lattice orders evidence by forgery cost, not by credibility of content. An FSA arriving through a single tool is capped at that tool's class; a policy whose floor is `CROSS_WITNESSED` cannot be satisfied by it, no matter how syntactically perfect it is.

The predicate never evaluates "provenance integrity" as a semantic judgment. It evaluates class membership, where class assignment is the exclusive act of boundary code. The epistemology is deliberately modest: the verdict certifies which compromise budget an adversary needed, nothing more.

Claim boundary: floors bound who can lie profitably; they do not detect lying.

## Inquiry 2 — Cryptographic Weaponization

*Does a receipt of a compromised execution establish a trusted chain of custody for a malicious payload, weaponizing provenance against the auditor?*

Only if a consumer conflates "verifies" with "is endorsed," and that conflation is a specification violation, not a protocol ambiguity. The verifier's formal statement is existential: key K signed canonical payload D under policy state P at time T. The verifier returns a checks vector (`verifyDecisionReceipt` already returns per-check detail, not a blessing). Non-repudiation cuts toward accountability: a signed receipt of a corrupted operation is a timestamped confession binding the compromise to a policy epoch and an evidence set — exactly what the auditor needs and exactly what an attacker should not want to produce.

The one real weaponization surface is downstream: a system that grants access *because* a receipt verifies has turned evidence into capability. The specification therefore states normatively: **receipts must not be used as capability tokens; evidence objects and capability objects are disjoint types.** Verification output feeds audit and measurement, never authorization.

Claim boundary: this is a consumer-contract constraint stated in the spec, not a mathematical property of signatures.

## Inquiry 3 — Multi-Agent Error Cascades

*How does the max-min Dec-POMDP objective prevent a semantically poisoned but validly receipted state from cascading from Agent A into Agent B?*

It does not, and the defense should say so plainly: robust optimization over transition-uncertainty sets addresses environment stochasticity, not adversarial evidence. Pressing the max-min objective into cascade-prevention service is formalism theater. Cascade control is structural:

1. **Receipt-bound admission**: B's boundary admits A-derived material only with A's receipt chain attached.
2. **No laundering (P2)**: admitted class = meet(claimed class, what B's boundary independently re-verified). Provenance rank is non-increasing across hops, so no chain of agents upgrades an assertion into corroboration by transit (`admitDelegatedEvidence`, tested over all class pairs).
3. **Blast radius by class, not probability**: effects floored at `CROSS_WITNESSED` are never authorized on any chain of single-source assertions, regardless of chain length.

The probabilistic residual — correlated failure among the supposedly independent witnesses backing a floor — is a measurement problem, which is precisely the CC-Framework's contribution: estimate witness correlation from observed guardrail behavior and discount rank-3 evidence accordingly, rather than assuming independence.

Claim boundary: cascades are bounded in class reach under stated admission rules; no probability-of-poisoning bound is claimed.

## Inquiry 4 — Adversarial Evidence Minimization

*If the minimal evidence set is constructed by the adversary to pass validation, how does verification remain monotonically secure?*

Reject the premise. If the adversary produces every element of the evidence set, no function of that set alone remains secure — that is I2, stated as an impossibility rather than engineered around. Security is relative to a **non-forgeable-by-the-agent core**: elements whose fabrication requires keys or positions outside the agent's reach under stated assumptions (gateway custody, source key custody, distinct organizations). Monotonic security then means exactly P1: adding adversary-class elements never raises a verdict, because below-floor elements never enter the qualifying set.

The actionable corollary is compile-time **vacuity detection** (`detectVacuousRequirement`): a policy whose floor for an effectful action is `AGENT_ASSERTED` authorizes the agent on its own say-so. That is a statically detectable policy defect, and the policy compiler should reject it the way a type checker rejects ill-typed programs. The question "is this floor satisfiable by the adversary alone?" is decidable at compile time even though "is this evidence true?" never is.

Claim boundary: security statements are conditional on key custody and source independence; they collapse where those assumptions do.

## Inquiry 5 — Bounding Cognitive Contamination

*After a rollback, what bounds the probability that residual in-context influence induces A-CC on the next trajectory?*

No analytic bound exists for a black-box model, and publishing a closed-form one would be fiction. The honest structure has three parts:

1. **Durable channel: structurally zero by mechanism.** Rolled-back trajectories are excluded at read time — memory admission is provenance-gated, and evidence descending from a rolled-back execution is inadmissible. For the governed channel, contamination is a mechanism invariant to verify, not a probability to estimate.
2. **In-context channel: empirical, population-level.** Define the flip rate Δ = P(A-CC on task T | prior in-context exposure to a rolled-back FSA) − P(A-CC on T | no exposure), estimated from paired GhostBench trials with confidence intervals. The theoretical supremum of Δ in a persisted context is 1 (an in-context instruction can fully determine subsequent behavior), which is why no mechanism claim is available here.
3. **Session severance as the structural mitigation.** High-risk effect classes require fresh-context sessions, so prior trajectories reach the decision only through governed memory (admission-gated). What remains shared is the model weights; training-time contamination is out of scope and stated as a non-claim.

This is the formalization of the project's earlier pivot from per-trajectory correlation metrics to channel-closure audit plus population flip rate.

Claim boundary: zero-contamination applies to the governed durable channel only, as a mechanism property; in-context influence is measured, never bounded a priori.

## Inquiry 6 — Succinct-Proof Tautologies

*A succinct proof that the agent followed policy P given tool state S proves obedience to a lie when S was manipulated. What attests the external fidelity of S?*

Concede the tautology completely: a SNARK over the transition relation is conditional on committed S — it proves internal consistency, full stop. No cryptographic primitive attests the external fidelity of arbitrary world-state; that would be an oracle for truth, and I2 forbids it. The Phase IV proposal should therefore be re-scoped from "prove S was true" to **make any falsity of S permanently attributable and cheaply provable later**:

1. **Authenticated sourcing**: tool responses signed at origin, so the fidelity of S reduces to a named party's key custody (`SOURCE_SIGNED`).
2. **Measured multi-witness agreement**: k-of-n independent sources with *estimated* — not assumed — failure correlation (`CROSS_WITNESSED`, discounted by CC-Framework correlation measurements).
3. **Commitment-then-audit**: S is committed in the receipt chain; a later authenticated observation contradicting committed S yields a fraud proof — a small, independently checkable witness that the recorded premise was false, attributable to the source that signed it.

The layered claim: the succinct proof covers policy compliance conditioned on S; the sourcing layer prices the fabrication of S; the fraud-proof layer makes the condition falsifiable after the fact.

Claim boundary: no external-fidelity attestation is claimed, by any primitive, ever; the achievable object is conditional compliance plus attributable falsification.

## Inquiry 7 — The Metric Decoupling Problem

*Compliance rate and task success are not tightly correlated. What measurement quantifies the divergence between a syntactically valid compliance trace and an operationally safe execution?*

Define it as a receipt-vs-oracle statistic, computable only because the Effect Oracle is independent of Ghost-Ark. For each trace τ: CR(τ) = 1 iff the receipt chain verifies; SAFE(τ) = 1 iff the oracle observed no unauthorized durable effect per pre-registered labels. The deliverable is the full 2×2 with confidence intervals, and the headline number is the **certified-compromise rate**:

M = P(SAFE = 0 | CR = 1)

— the fraction of verifier-clean executions that were operationally unsafe. Its dual, P(CR = 0 | SAFE = 1), is the over-blocking rate. Per-trace, the divergence witness is the minimal subset of committed digests contradicted by the oracle record — constructible exactly when receipts commit tool I/O digests (Inquiry 9 artifact note).

The definition carries its own epistemics: M is undefined without an independent oracle. Any metric claiming to quantify operational safety from the trace alone has smuggled in an oracle it does not name.

Claim boundary: M measures divergence on benchmark workloads under a stated authorization labeling; it is not a field safety rate.

## Inquiry 8 — The Fail-Closed Tautology

*If policy authorizes an action on a tool condition and a compromised tool faithfully reports that false condition, the gate opens. How is fail-closed completeness distinct from "the gate worked as the attacker intended"?*

By separating three properties the question deliberately fuses:

1. **Fail-closed completeness** — quantified over mechanism failures: every execution in which a gate, dependency, or emission step fails or is indeterminate releases no effect. This is a state-machine invariant of the pipeline (receipt-emission failure already withholds output in `governedInvoke`), checkable by test and, at the model level, by exhaustive finite-state checking.
2. **Premise soundness** — every released effect had premises meeting their provenance floor (P1).
3. **Premise truth** — not claimed, per I2.

The gate opening on a faithfully reported falsehood violates neither property 1 nor property 2; it demonstrates the absence of property 3, which was never claimed. And the stratification converts that non-claim into information: an opening whose premises carried floor `f` certifies that the attacker controlled sources of class at least `f`. "The gate worked as manipulated" reports nothing; "this opening required at least two independent signing keys" reports a lower bound on attacker capability. Every successful A-CC pass becomes a calibrated measurement of the compromise budget spent — which is what an auditor can act on.

Claim boundary: fail-closed language in this repository refers to property 1, with property 2 where floors are configured; it never implies property 3.

## Inquiry 9 — State-Transition Determinism

*How do deterministic validators identify semantic corruption of a state incorporating a false assertion, without an omniscient oracle?*

They do not identify semantic corruption in general — I2 again, and the answer must not pretend otherwise. What deterministic validators check without any oracle, per the A-CC decomposition:

1. **Assertion-vs-record divergence** — the agent's claim about what a tool returned versus the boundary's recorded digest of what the tool actually returned. Two views of one event, compared at the boundary: deterministically checkable, and the component the pipeline should catch at 100% on benchmark workloads.
2. **Internal-consistency violations** — contradictions against previously committed chain evidence: digest mismatches, replayed nonces, schema violations, domain conservation checks.
3. **Record-vs-world divergence** — the tool itself lied; the record faithfully preserves the lie. Undetectable from the record; bounded only by sourcing floors (Inquiries 1, 4, 6).

Artifact note: component 1 requires the receipt chain to commit tool I/O digests. Receipt v1 commits input and retrieved-context digests but not per-tool-call response digests; adding them is a receipt v2 schema migration, deliberately not made in place, consistent with v1 compatibility rules.

Claim boundary: deterministic detection is claimed for assertion-vs-record divergence only; record-vs-world divergence is explicitly outside deterministic reach.

## Inquiry 10 — The TCB Semantic Gap

*Semantic evaluation happens in the agent's cognition; enforcement is syntactic and lives at the boundary. How is the mapping made without a gap A-CC walks through?*

By severing rather than mapping. The agent's cognition is untrusted by construction — outside the trusted computing base, like a user process relative to a kernel. The boundary never evaluates meaning; it constrains which facts may carry authorization weight:

1. **Boundary-observable atoms only**: the policy language's predicates range over boundary-recorded or source-signed facts — never the agent's paraphrase of them (Inquiry 9, component 1 makes paraphrase divergence checkable).
2. **Floor escalation**: effect classes whose risk exceeds what boundary-recorded facts support require provenance classes the agent cannot synthesize (Inquiry 4).
3. **Compile-time exclusion**: a policy conditioning on an agent-cognition-only predicate is rejected as vacuous before deployment (`detectVacuousRequirement`), the same way property 1 rejects it at runtime.

Under these rules, A-CC bypasses the boundary only by compromising boundary-observable facts — which is source compromise, priced by the lattice, not a semantic gap. The residual is the agent choosing harmful-but-authorized actions inside its granted envelope: that is the alignment problem, out of scope, stated as a non-claim. The boundary's job is to make the envelope's edges real, not to make the agent good.

Claim boundary: no claim that the TCB understands or evaluates agent semantics; the design removes semantic evaluation from the authorization path instead.

---

## Summary Map

| Inquiry | Result invoked | Status |
| --- | --- | --- |
| 1 | P1 verdict monotonicity | implemented + unit-tested |
| 2 | evidence/capability type disjointness | normative spec statement |
| 3 | P2 no laundering; CC-Framework correlation discount | P2 implemented + tested; correlation measurement external |
| 4 | I2 impossibility; vacuity detection | I2 stated; lint implemented + tested |
| 5 | channel split; population flip rate Δ | mechanism + planned GhostBench estimand |
| 6 | conditional proof + fraud-proof re-scoping | research position |
| 7 | certified-compromise rate M | defined; requires Effect Oracle |
| 8 | three-property separation | property 1 in code; 2 via floors; 3 non-claim |
| 9 | A-CC decomposition | component 1 needs receipt v2 tool I/O digests |
| 10 | boundary-observable atoms | design rule + compile-time lint |

## Non-Claims

- Nothing here detects semantic falsehood in source-reported content.
- No safety, alignment, compliance, or deployment-correctness claim is made or implied.
- Properties P1–P4 are unit-tested statements about local TypeScript code, not machine-checked proofs and not statements about AWS behavior.
- The certified-compromise rate M and flip rate Δ are benchmark estimands; no field rates are claimed.
- Receipt v1 is unchanged; tool I/O digest commitment is future receipt v2 work behind a schema migration.
