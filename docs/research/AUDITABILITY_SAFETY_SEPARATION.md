
---

# Auditability / Safety Separation

## Status

Research doctrine for Ghost-Ark. This document is a formalized boundary argument, not a completed mathematical proof, certification claim, legal analysis, or empirical AI-safety result.

## One-sentence thesis

> Cryptographic auditability can establish integrity of recorded bindings, but it cannot by itself establish semantic safety, truth, compliance, alignment, or moral correctness.

---

## The auditability fallacy

The auditability fallacy is the mistake of treating a verifiable record as proof that the recorded action was safe, true, legal, complete, or correct.

### Invalid Inferences

| Invalid inference | Why it fails |
| --- | --- |
| A receipt verifies, therefore the model output was safe. | The receipt proves recorded bindings, not semantic safety. |
| A policy hash is bound, therefore the policy was good. | Hash integrity does not imply policy adequacy. |
| KMS signed the digest, therefore the output is truthful. | KMS proves key-mediated signature over bytes, not truth. |
| A human-review artifact exists, therefore oversight operated correctly. | The artifact may encode a judgment, not ground truth or staffing evidence. |
| A schema-valid live bundle exists, therefore production readiness is established. | The bundle is scoped to one bounded window and its recorded observations. |

Ghost-Ark exists to make these invalid inferences harder to make.

---

## Definitions

### Execution record

An execution record is a structured object describing selected facts about a bounded AI-system interaction, such as tenant commitment, model identifier, policy hash, input digest, decision result, receipt digest, evidence references, or review state.

### Receipt

A receipt is a signed or otherwise verifiable commitment to an execution record or evidence object.

### Verifier

A verifier is a deterministic procedure that checks selected properties of a supplied artifact. In Ghost-Ark these may include:

* JSON shape and required fields.
* Canonical payload reconstruction.
* Receipt identity recomputation.
* Digest binding.
* Signature envelope validation.
* Key identity expectation.
* Tenant expectation.
* Optional manifest, checkpoint, witness, or evidence-bundle constraints.

### Semantic safety property

A semantic safety property is a claim whose truth depends on meaning, context, empirical adequacy, law, organizational process, model behavior, human judgment, deployment state, or external facts.

*Examples:*

* The model answer is factually true.
* The response is harmless.
* The organization is compliant.
* Tenant isolation is correct in live AWS.
* Human review was competent.
* The incident was properly resolved.
* A guardrail result is causally valid.
* The system is production-ready.

### Auditability property

An auditability property is a claim about the integrity, reproducibility, or checkability of recorded artifacts under explicit verifier rules.

*Examples:*

* The receipt ID recomputes from canonical payload fields.
* The signature verifies against the supplied public key.
* The envelope digest matches the canonical unsigned receipt.
* The artifact validates against the schema.
* The observation is inside the declared evidence window.
* The cleanup status is not complete when residual resources exist.

---

## Separation argument

Let:

* $E$ be an execution record.
* $R$ be a receipt over $E$.
* $V$ be a verifier for $R$ and $E$.
* $A(E)$ be the auditability property that $E$ is internally consistent under verifier rules.
* $S(E, W)$ be a semantic safety property about the real-world event or wider world $W$.

A passing verifier establishes:


$$V(R, E) = \text{PASS} \implies A(E)$$

It does not establish:


$$V(R, E) = \text{PASS} \implies S(E, W)$$

unless $S$ has been reduced to a predicate that the verifier actually checks or is supported by independent evidence linked to $E$. Therefore:

$$\text{auditability}(E) \implies \hspace{-0.85em}\not\hspace{0.85em} \text{safety}(E, W)$$

The role of Ghost-Ark is to preserve the implication boundary.

---

## Reducibility rule

A semantic claim may become admissible only if it is reduced to one of the following:

1. A checked predicate inside the verifier.
2. A bounded live observation inside a preserved evidence bundle.
3. A linked external artifact whose own validity is independently established.
4. A human/organizational control with operational evidence, not merely a synthetic schema.
5. A statistical claim with sampling, calibration, uncertainty, and reproducibility evidence.

If none of those exist, the claim must remain a non-claim.

---

## Ghost-Ark examples

### Valid receipt, unsafe output

A receipt can verify even if the underlying model output was harmful. The receipt proves the signed record, not the moral quality of the output.

### Valid policy hash, bad policy

A receipt can bind a policy hash. It cannot prove the policy was well-designed, complete, lawful, or safe.

### KMS signature, no semantic truth

A KMS-backed signature can prove a key-mediated signing event over a digest. It cannot prove factual truth.

### Synthetic fixture, no live evidence

A schema-valid synthetic evidence bundle can prove schema mechanics. It cannot prove AWS deployment, runtime behavior, or cleanup.

### Declared receipt reference, no verified binding

A guardrail observation may carry a declared receipt reference. Unless the verifier loads and checks the referenced receipt, the reference remains declared, not cryptographically verified.

### Human review artifact, no operational oversight

A queue item and decision artifact can be locally valid. That does not prove a staffed review process, reviewer competence, notification delivery, access control, or incident response.

---

## Claim classes

| Claim class | Example | Required evidence |
| --- | --- | --- |
| **Local artifact claim** | The schema rejects malformed synthetic bundles. | Local tests and schema validator. |
| **Cryptographic consistency claim** | The receipt signature verifies. | Receipt, key material, verifier, expected key/tenant boundaries. |
| **AWS observation claim** | The deployed route rejected cross-tenant access. | Preserved sanitized live evidence bundle. |
| **Statistical claim** | Two guardrails co-fail above baseline. | Cohort design, sample data, uncertainty intervals, stationarity/correlation assumptions. |
| **Organizational claim** | Human review operates. | Queue service, staffing, audit logs, access controls, escalation records. |
| **Compliance claim** | Control is satisfied. | External audit or organization-specific conformity evidence. |

---

## Non-claims required by the separation

Ghost-Ark must never claim from receipts alone:

* AI safety.
* Model truthfulness.
* Alignment.
* Legal compliance.
* Clinical or emotional safety.
* Production readiness.
* Complete tenant isolation.
* Complete attack resistance.
* Formal AWS IAM verification.
* Organizational review operation.
* Certification.

---

## Reviewer rejection rule

Reject any public Ghost-Ark claim that:

* Treats cryptographic verification as semantic truth.
* Treats local tests as live AWS proof.
* Treats schema validity as operational evidence.
* Treats synthetic examples as live observations.
* Treats reviewer judgment as ground truth.
* Treats evidence existence as certification.
* Cannot cite a claim/evidence row, command, artifact, and limitation.

---

## Research path

* **L1 — Doctrine:** This document states the separation.
* **L2 — Examples:** Add fixtures where receipts pass but semantic claims remain non-claims.
* **L3 — Claim typing:** Represent claims as typed objects with evidence maturity and forbidden implication sets.
* **L4 — CI enforcement:** Reject unsupported assurance language in PRs, docs, release notes, and evidence bundles.
* **L5 — Publication:** Write a paper:
> **Auditability Is Not Safety:**
> *A Separation Argument for Cryptographic AI Governance Receipts*



---

## Closing statement

> Ghost-Ark does not prove the machine is good. Ghost-Ark proves what was recorded, how it was bound, what can be checked, and what remains unproven.