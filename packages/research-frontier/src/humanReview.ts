import { z } from "zod";

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const hmacSha256DigestSchema = z
  .string()
  .regex(/^hmac-sha256:[a-f0-9]{64}$/);

export const receiptReferenceSchema = z
  .object({
    receipt_id: z.string().min(1),
    receipt_digest: sha256DigestSchema,
  })
  .strict();

export type ReviewReceiptReference = z.infer<typeof receiptReferenceSchema>;

export const evidenceReferenceSchema = z
  .object({
    artifact_type: z.enum([
      "guardrail_observation",
      "receipt",
      "policy",
      "verifier_report",
      "review_queue_item",
      "review_decision",
      "review_attachment",
      "incident_timeline",
    ]),
    artifact_id: z.string().min(1),
    artifact_digest: sha256DigestSchema,
  })
  .strict();

export type ReviewEvidenceReference = z.infer<
  typeof evidenceReferenceSchema
>;

const auditLinkSchema = z
  .object({
    event_id: z.string().regex(/^audit_[A-Za-z0-9_-]+$/),
    event_digest: sha256DigestSchema,
    previous_event_digest: sha256DigestSchema.nullable(),
  })
  .strict();

const reviewPrivacySchema = z
  .object({
    raw_content_included: z.literal(false),
    notes_storage: z.literal("digest_only"),
    redaction_policy_digest: sha256DigestSchema,
  })
  .strict();

export const humanReviewQueueItemSchema = z
  .object({
    schema_version: z.literal("ghostark.research.human_review_queue_item.v1"),
    queue_item_id: z.string().regex(/^hrq_[A-Za-z0-9_-]+$/),
    created_at: z.string().datetime(),
    status: z.enum([
      "pending",
      "in_review",
      "resolved",
      "escalated",
      "cancelled",
    ]),
    priority: z.enum(["low", "medium", "high", "critical"]),
    trigger: z
      .object({
        type: z.enum([
          "guardrail_flag",
          "policy_exception",
          "receipt_verification_failure",
          "operator_report",
          "automated_alert",
        ]),
        observation_id: z.string().regex(/^gobs_[A-Za-z0-9_-]+$/).nullable(),
        observation_digest: sha256DigestSchema.nullable(),
        reason_codes: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .superRefine((trigger, context) => {
        const hasId = trigger.observation_id !== null;
        const hasDigest = trigger.observation_digest !== null;
        if (hasId !== hasDigest) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "observation_id and observation_digest must both be present or both be null",
          });
        }
        if (trigger.type === "guardrail_flag" && !hasId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "guardrail_flag trigger requires an observation reference",
          });
        }
      }),
    receipt_references: z.array(receiptReferenceSchema).min(1),
    evidence_references: z.array(evidenceReferenceSchema).min(1),
    assignment: z
      .object({
        reviewer_role: z.string().min(1),
        reviewer_id_hash: hmacSha256DigestSchema.nullable(),
        review_due_at: z.string().datetime(),
      })
      .strict(),
    privacy: reviewPrivacySchema,
    audit: auditLinkSchema,
    non_claims: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((queueItem, context) => {
    if (Date.parse(queueItem.assignment.review_due_at) < Date.parse(queueItem.created_at)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "review_due_at must not precede created_at",
      });
    }
    addDuplicateReceiptIssues(queueItem.receipt_references, context);
  });

export type HumanReviewQueueItem = z.infer<
  typeof humanReviewQueueItemSchema
>;

export const humanReviewDecisionSchema = z
  .object({
    schema_version: z.literal("ghostark.research.human_review_decision.v1"),
    decision_id: z.string().regex(/^hrd_[A-Za-z0-9_-]+$/),
    queue_item_id: z.string().regex(/^hrq_[A-Za-z0-9_-]+$/),
    decided_at: z.string().datetime(),
    reviewer: z
      .object({
        reviewer_role: z.string().min(1),
        reviewer_id_hash: hmacSha256DigestSchema,
      })
      .strict(),
    disposition: z.enum([
      "confirmed_violation",
      "false_positive",
      "needs_more_evidence",
      "escalated",
      "no_action",
    ]),
    rationale_codes: z.array(z.string().min(1)).min(1),
    rationale_digest: sha256DigestSchema,
    receipt_references: z.array(receiptReferenceSchema).min(1),
    evidence_references: z.array(evidenceReferenceSchema).min(1),
    escalation: z
      .object({
        required: z.boolean(),
        incident_id: z.string().regex(/^inc_[A-Za-z0-9_-]+$/).nullable(),
        reason_code: z.string().min(1).nullable(),
      })
      .strict(),
    privacy: reviewPrivacySchema,
    audit: auditLinkSchema,
    non_claims: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((decision, context) => {
    const isEscalated = decision.disposition === "escalated";
    const hasEscalationFields =
      decision.escalation.incident_id !== null &&
      decision.escalation.reason_code !== null;

    if (
      isEscalated !== decision.escalation.required ||
      isEscalated !== hasEscalationFields
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "escalated disposition requires an incident id and reason; other dispositions must not declare escalation",
      });
    }
    addDuplicateReceiptIssues(decision.receipt_references, context);
  });

export type HumanReviewDecision = z.infer<typeof humanReviewDecisionSchema>;

const incidentTimelineEventSchema = z
  .object({
    event_id: z.string().regex(/^inctl_[A-Za-z0-9_-]+$/),
    occurred_at: z.string().datetime(),
    event_type: z.enum([
      "opened",
      "triaged",
      "evidence_added",
      "contained",
      "resolved",
      "closed",
    ]),
    actor_role: z.string().min(1),
    evidence_digest: sha256DigestSchema,
  })
  .strict();

export const incidentReportSchema = z
  .object({
    schema_version: z.literal("ghostark.research.incident_report.v1"),
    incident_id: z.string().regex(/^inc_[A-Za-z0-9_-]+$/),
    opened_at: z.string().datetime(),
    status: z.enum(["open", "triaged", "contained", "resolved", "closed"]),
    severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
    category: z.enum([
      "guardrail_failure",
      "receipt_integrity",
      "privacy",
      "policy_bypass",
      "availability",
      "other",
    ]),
    source: z
      .object({
        queue_item_id: z.string().regex(/^hrq_[A-Za-z0-9_-]+$/),
        review_decision_id: z.string().regex(/^hrd_[A-Za-z0-9_-]+$/),
      })
      .strict(),
    receipt_references: z.array(receiptReferenceSchema).min(1),
    evidence_references: z.array(evidenceReferenceSchema).min(1),
    impact: z
      .object({
        assessment: z.enum(["under_investigation", "bounded"]),
        affected_receipt_count: z.number().int().nonnegative(),
        tenant_scope_hashes: z.array(hmacSha256DigestSchema),
      })
      .strict(),
    escalation: z
      .object({
        level: z.enum(["team", "security", "governance", "executive"]),
        owner_role: z.string().min(1),
        response_due_at: z.string().datetime(),
      })
      .strict(),
    timeline: z.array(incidentTimelineEventSchema).min(1),
    closure: z
      .object({
        closed_at: z.string().datetime().nullable(),
        resolution_code: z
          .enum(["false_alarm", "mitigated", "accepted_risk", "unresolved"])
          .nullable(),
        postmortem_digest: sha256DigestSchema.nullable(),
      })
      .strict(),
    privacy: reviewPrivacySchema,
    audit: auditLinkSchema,
    non_claims: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((incident, context) => {
    const openedAt = Date.parse(incident.opened_at);
    if (incident.timeline[0].event_type !== "opened") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "incident timeline must begin with an opened event",
      });
    }

    let previousTime = openedAt;
    for (const event of incident.timeline) {
      const occurredAt = Date.parse(event.occurred_at);
      if (occurredAt < previousTime) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "incident timeline events must be chronological",
        });
        break;
      }
      previousTime = occurredAt;
    }

    if (Date.parse(incident.escalation.response_due_at) < openedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "incident response_due_at must not precede opened_at",
      });
    }

    const isClosed = incident.status === "resolved" || incident.status === "closed";
    const hasClosure =
      incident.closure.closed_at !== null &&
      incident.closure.resolution_code !== null &&
      incident.closure.postmortem_digest !== null;
    if (isClosed !== hasClosure) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "resolved or closed incidents require complete closure evidence; active incidents must leave closure fields null",
      });
    }

    addDuplicateReceiptIssues(incident.receipt_references, context);
  });

export type IncidentReport = z.infer<typeof incidentReportSchema>;

export interface HumanReviewWorkflowArtifacts {
  queueItem: HumanReviewQueueItem;
  decision: HumanReviewDecision;
  incident?: IncidentReport;
}

function addDuplicateReceiptIssues(
  references: ReviewReceiptReference[],
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const reference of references) {
    if (ids.has(reference.receipt_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate receipt reference: ${reference.receipt_id}`,
      });
      return;
    }
    ids.add(reference.receipt_id);
  }
}

function assertReceiptReferencesCarriedForward(params: {
  source: ReviewReceiptReference[];
  target: ReviewReceiptReference[];
  transition: string;
}): void {
  const targetById = new Map(
    params.target.map((reference) => [
      reference.receipt_id,
      reference.receipt_digest,
    ]),
  );

  for (const reference of params.source) {
    if (targetById.get(reference.receipt_id) !== reference.receipt_digest) {
      throw new Error(
        `${params.transition} must carry forward receipt ${reference.receipt_id} with the same digest`,
      );
    }
  }
}

export function validateHumanReviewQueueItem(
  value: unknown,
): HumanReviewQueueItem {
  return humanReviewQueueItemSchema.parse(value);
}

export function validateHumanReviewDecision(
  value: unknown,
): HumanReviewDecision {
  return humanReviewDecisionSchema.parse(value);
}

export function validateIncidentReport(value: unknown): IncidentReport {
  return incidentReportSchema.parse(value);
}

export function validateHumanReviewWorkflowLinkage(params: {
  queueItem: unknown;
  decision: unknown;
  incident?: unknown;
}): HumanReviewWorkflowArtifacts {
  const queueItem = validateHumanReviewQueueItem(params.queueItem);
  const decision = validateHumanReviewDecision(params.decision);
  const incident =
    params.incident === undefined
      ? undefined
      : validateIncidentReport(params.incident);

  if (decision.queue_item_id !== queueItem.queue_item_id) {
    throw new Error("review decision must reference its queue item");
  }
  if (Date.parse(decision.decided_at) < Date.parse(queueItem.created_at)) {
    throw new Error("review decision must not precede queue item creation");
  }
  if (decision.audit.previous_event_digest !== queueItem.audit.event_digest) {
    throw new Error("review decision audit link must reference the queue event digest");
  }
  assertReceiptReferencesCarriedForward({
    source: queueItem.receipt_references,
    target: decision.receipt_references,
    transition: "queue-to-decision transition",
  });

  const allowedQueueStatuses: readonly HumanReviewQueueItem["status"][] =
    decision.disposition === "escalated"
      ? ["in_review", "escalated"]
      : decision.disposition === "needs_more_evidence"
        ? ["in_review"]
        : ["in_review", "resolved"];
  if (!allowedQueueStatuses.includes(queueItem.status)) {
    throw new Error(
      `queue status is incompatible with ${decision.disposition} disposition`,
    );
  }

  if (decision.escalation.required && incident === undefined) {
    throw new Error("escalated review decision requires an incident artifact");
  }
  if (!decision.escalation.required && incident !== undefined) {
    throw new Error("incident artifact requires an escalated review decision");
  }

  if (incident !== undefined) {
    if (incident.incident_id !== decision.escalation.incident_id) {
      throw new Error("incident id must match the review escalation reference");
    }
    if (
      incident.source.queue_item_id !== queueItem.queue_item_id ||
      incident.source.review_decision_id !== decision.decision_id
    ) {
      throw new Error("incident source must reference the queue item and decision");
    }
    if (incident.audit.previous_event_digest !== decision.audit.event_digest) {
      throw new Error("incident audit link must reference the decision event digest");
    }
    assertReceiptReferencesCarriedForward({
      source: decision.receipt_references,
      target: incident.receipt_references,
      transition: "decision-to-incident transition",
    });
  }

  return { queueItem, decision, ...(incident === undefined ? {} : { incident }) };
}
