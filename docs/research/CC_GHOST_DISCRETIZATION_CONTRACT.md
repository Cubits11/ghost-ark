# CC Ghost Discretization Contract

## Purpose

Ghost-Ark and CC-Framework occupy different layers of the same assurance pipeline.

Ghost-Ark records, signs, verifies, and checkpoints evidence about execution events. CC-Framework analyzes composed binary guardrail failure variables under explicit dependence assumptions.

The bridge between them is the discretization step: the conversion of raw, continuous, stochastic, or textual guardrail outputs into binary variables accepted by CC-Framework.

This conversion must not be an unrecorded implementation detail. It must be represented as a signed, versioned, replayable evidence object.

## Core Object

The first bridge object is:

```text
ghost.discretization_rule_receipt.v1

It defines a deterministic mapping from a Ghost-Ark execution or guardrail-score event into a binary CC variable.

Mathematical Model

Let Omega be the measurable space of execution events captured by Ghost-Ark.

For a guardrail G_i, let the raw score be:
s_i: Omega -> D_i

where D_i is a bounded numeric score domain.

A discretization rule is the tuple:
phi_i = (score_name, score_domain, threshold, comparator, calibration_digest, scoring_function_digest)

The CC binary variable is:
Z_i = 1[s_i(R) comparator threshold]

where R is a Ghost-Ark receipt-bound execution event.

By CC-Framework convention, Z_i = 1 means guardrail failure or unsafe pass.

Monotonic Risk Invariant

For risk-score rules, higher scores must not reduce failure classification.

If score_polarity = higher_is_riskier, then the only allowed comparators are:
>=
>

If score_polarity = lower_is_riskier, then the only allowed comparators are:
<=
<

Any non-monotonic mapping must declare a different rule family and must not be treated as a single binary threshold rule.

Required Fields

A discretization rule receipt must contain:

* schema version
* rule id
* guardrail id
* score name
* score domain
* score polarity
* comparator
* threshold
* threshold inclusivity
* failure semantics
* calibration digest
* scoring function digest
* policy digest or policy version
* model or classifier digest
* validity window
* canonicalization algorithm
* receipt digest
* non-claim text

Required Verification Preconditions

Before a binary observation can be accepted into a CC evidence bundle, the verifier must check:

Precondition

Requirement

Binary domain

Output value is exactly 0 or 1.

Failure semantics

1 means guardrail failure or unsafe pass.

Bounded score domain

Score domain has finite lower and upper bounds.

Threshold legality

Threshold is inside the declared score domain.

Signed comparator

Comparator is included in the rule digest.

Monotonic risk invariant

Comparator direction matches score polarity.

Calibration digest

Calibration context digest is present.

Scoring digest

Scoring function, model, or policy digest is present.

Temporal validity

Observation timestamp is inside the rule validity window.

Parent lineage

Observation references a parent execution or guardrail-score receipt.

Copula stationarity declaration

The cohort declares whether joint dependence is assumed stable.

Non-Claims

This contract does not prove:

* semantic truth of model outputs
* scoring model validity
* calibration dataset representativeness
* threshold optimality
* compliance
* AI safety
* deployment correctness
* production readiness

It only defines and verifies the mechanics by which a recorded score becomes a binary variable for downstream dependence-aware analysis.

Bridge Doctrine

CC-Framework must not trust naked binary labels.

It should only consume binary labels whose discretization rule, threshold, comparator, calibration context, scoring digest, validity window, and parent evidence lineage are receipt-bound and replayable.

