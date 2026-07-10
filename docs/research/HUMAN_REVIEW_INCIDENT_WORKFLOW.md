# Human Review And Incident Workflow

## Purpose

This document defines three local research artifacts and the linkage rules between them:

1. a human review queue item;
2. a human review decision;
3. an incident report created by an escalated decision.

The workflow exists to make declared evidence lineage inspectable. It is not an operating queue, staffing model, notification service, case-management system, or incident response program.

## Maturity

Under `docs/research/ASSURANCE_MATURITY_LADDER.md`, the queue, decision, and incident formats are L2 schema-bound. Their local validation and cross-artifact linkage checks are L3 unit-tested.

Evidence:

- `schemas/research/human-review-queue-item.schema.json`
- `schemas/research/human-review-decision.schema.json`
- `schemas/research/incident-report.schema.json`
- `packages/research-frontier/src/humanReview.ts`
- `examples/research/human-review/`
- `tests/unit/research-frontier/humanReview.test.ts`

Verification command:

```bash
npx vitest run tests/unit/research-frontier/humanReview.test.ts
```

## Artifact Roles

| Artifact | Required evidence boundary |
| --- | --- |
| Queue item | Trigger, at least one receipt reference, at least one evidence reference, reviewer role, due time, privacy block, and audit event. |
| Review decision | Queue identifier, reviewer pseudonym, disposition, rationale codes and digest, carried receipt references, evidence references, escalation declaration, and chained audit event. |
| Incident report | Escalated queue and decision identifiers, carried receipt references, evidence references, bounded or still-unknown impact, escalation owner and due time, chronological timeline, closure state, and chained audit event. |

Receipt and evidence references contain identifiers and SHA-256 digests. The local validators check their format and carry-forward consistency. They do not load the referenced artifact, recompute the digest, verify a receipt signature, or establish evidence truth.

## Workflow

### Queue

A queue item may be triggered by a guardrail flag, policy exception, receipt verification failure, operator report, or automated alert.

A guardrail trigger must include both an observation identifier and its digest. Other triggers may omit both. A partial pair fails closed.

Queue status values are `pending`, `in_review`, `resolved`, `escalated`, and `cancelled`. The local fixture chains use `in_review` snapshots. A later service may persist state transitions, but no stateful queue implementation is present here.

### Decision

A review decision records one of:

- `confirmed_violation`;
- `false_positive`;
- `needs_more_evidence`;
- `escalated`;
- `no_action`.

Free-text rationale is not stored in the artifact. The decision carries reason codes and a digest of any separately controlled rationale record.

Only `escalated` may set `escalation.required` to `true`. It must also declare an incident identifier and reason code. Every other disposition must keep the incident identifier and reason code null.

The `false-positive-decision.json` fixture demonstrates a false-positive disposition. That value is a recorded reviewer judgment. It is not independently established ground truth and does not show that the reviewer was correct.

### Incident

An escalated decision requires an incident artifact in the cross-artifact validator. The incident must reference the same queue item and decision, carry forward the decision's receipt references, and continue the audit digest chain.

The incident records severity, category, current impact assessment, response owner, response due time, and a chronological evidence-digest timeline. An active incident keeps all closure fields null. A `resolved` or `closed` incident requires a close time, resolution code, and postmortem digest.

The checked-in incident is a triaged synthetic fixture. It is not evidence that a real incident occurred or that an incident team responded.

## Linkage Invariants

`validateHumanReviewWorkflowLinkage` enforces:

```text
queue.queue_item_id == decision.queue_item_id
queue.audit.event_digest == decision.audit.previous_event_digest
queue receipt references are present unchanged in the decision

for escalation:
decision.escalation.incident_id == incident.incident_id
incident.source == { queue item id, decision id }
decision.audit.event_digest == incident.audit.previous_event_digest
decision receipt references are present unchanged in the incident
```

The carry-forward rule prevents a downstream artifact from silently dropping or changing an upstream receipt digest. An incident may add newly discovered receipt references, but it may not remove or mutate carried references.

The validators also reject duplicate receipt identifiers, review decisions dated before queue creation, non-chronological incident timelines, incomplete escalation fields, and incomplete closure evidence.

## Privacy Boundary

Every artifact fixes:

- `raw_content_included` to `false`;
- `notes_storage` to `digest_only`;
- a redaction policy digest.

Reviewer identifiers and tenant scopes use HMAC-derived pseudonyms. They remain linkable and may still be sensitive. The schemas do not manage keys, access control, retention, deletion, or lawful disclosure.

Review attachments are digest references only. A future storage system must define separate authorization, redaction, retention, and evidence-access rules before storing reviewer notes or source content.

## Escalation And Closure Expectations

The schema records a response due time and owner role, but it does not send a page, create a ticket, enforce an SLA, verify acknowledgement, or measure response performance.

Severity and impact are recorded assertions. Reviewers must keep `impact.assessment` as `under_investigation` until the evidence supports a bounded scope. Closing an incident requires a separate postmortem artifact digest; the schema does not judge whether the postmortem is adequate.

## Non-Claims

These artifacts do not demonstrate:

- continuous reviewer coverage;
- reviewer competence, independence, or correctness;
- operational escalation or notification delivery;
- incident containment or recovery;
- evidence authenticity or completeness;
- receipt signature verification;
- service-level attainment;
- live AWS integration;
- deployment readiness;
- compliance or certification.

The bounded claim is: the repository defines and locally tests closed schemas plus cross-artifact receipt and audit linkage rules for synthetic human-review and incident fixtures.
