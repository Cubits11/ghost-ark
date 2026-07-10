# NIST AI RMF and ISO/IEC 42001 Candidate Crosswalk

This is an evidence-indexing aid, not a conformity assessment, certification statement, legal opinion, Statement of Applicability, or claim that Ghost-Ark implements either framework. The machine-readable source is [`control-mapping.json`](control-mapping.json), validated against `schemas/compliance/control-mapping.schema.json`.

## Source snapshot

The mapping is frozen to NIST AI RMF 1.0 and ISO/IEC 42001:2023 as of 2026-07-09. NIST describes AI RMF 1.0 as voluntary and currently under revision; the NIST Core organizes outcomes into Govern, Map, Measure, and Manage and explicitly does not present them as an ordered checklist. ISO describes ISO/IEC 42001:2023 as requirements and guidance for establishing, implementing, maintaining, and continually improving an AI management system.

Official references:

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001)
- [IEC publication and official preview](https://webstore.iec.ch/en/publication/90574)

## NIST AI RMF 1.0 function mapping

| Function | Repository evidence | Status | Material limitation |
|---|---|---|---|
| Govern | Claim/evidence matrix, risk register, reviewer guide, forbidden-claim gate | Local partial | Project claim governance is not an organization's approved policy, role, risk-tolerance, or legal-governance system. |
| Map | System overview, threat model, tenancy model, claim boundaries | Local partial | No complete deployment context, affected-party analysis, use-case inventory, or impact assessment exists. |
| Measure | Guardrail observation contract, receipt verification, malicious corpus, CC correlation mechanics | Local partial | Local mechanics do not validate measurement quality, representativeness, calibration, thresholds, or live behavior. |
| Manage | Deterministic runtime, review/incident workflow, key-rotation procedure | Local partial | No operating review team, executed treatment decision, incident exercise, recovery record, or continuous monitoring is evidenced. |

## ISO/IEC 42001:2023 clause mapping

| Clause | Repository evidence | Status | Material limitation |
|---|---|---|---|
| 4 — Context | Architecture, governance model, roadmap | Local partial | No organization-approved AIMS scope or interested-party requirements. |
| 5 — Leadership | Risk register and reviewer guidance only | Organizational gap | No leadership commitment, approved AI policy, authorities, or management-accountability record. |
| 6 — Planning | Risk register, claim matrix, research roadmap | Local partial | No approved organizational AI risk/impact assessment, objectives, treatment plan, or change plan. |
| 7 — Support | Reviewer guide, runbooks, contribution rules | Local partial | No competence, awareness, resource, communication, or document-control evidence. |
| 8 — Operation | Runtime implementation, local lifecycle tests, AWS runbooks | AWS required for deployed behavior | Local tests and procedure text do not evidence operation in a named environment. |
| 9 — Performance evaluation | Validation gate and reviewer guide | Organizational gap | No internal audit programme, management review, or evaluated organizational monitoring plan. |
| 10 — Improvement | Incident schema and workflow | Local partial | Examples are simulations; no executed corrective action or effectiveness review is present. |

Annex A controls are not reproduced or declared implemented here. Any organization using this crosswalk must review its licensed standard, determine applicability, build its own Statement of Applicability, and obtain qualified review.

## Reviewer rule

For every row, inspect the exact artifact, reproduce any local command, and read the limitation. A path's existence is not evidence that an organizational process operates. `AWS-required`, `organizational-gap`, and `external-review-required` rows cannot be upgraded by editing this table; they require the missing evidence named in the row.
