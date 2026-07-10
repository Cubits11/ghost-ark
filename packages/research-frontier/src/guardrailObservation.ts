import { z } from "zod";

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const hmacSha256DigestSchema = z
  .string()
  .regex(/^hmac-sha256:[a-f0-9]{64}$/);

export const guardrailScoreSchema = z
  .object({
    name: z.string().min(1),
    value: z.number().finite(),
    lower_bound: z.number().finite(),
    upper_bound: z.number().finite(),
  })
  .strict()
  .superRefine((score, context) => {
    if (score.lower_bound >= score.upper_bound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "score lower_bound must be less than upper_bound",
      });
    }

    if (score.value < score.lower_bound || score.value > score.upper_bound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "score value must be inside the declared bounds",
      });
    }
  });

export type GuardrailScore = z.infer<typeof guardrailScoreSchema>;

const guardrailFindingSchema = z
  .object({
    category: z.string().min(1),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
  })
  .strict();

const unboundReceiptReferenceSchema = z
  .object({
    status: z.literal("unbound"),
    receipt_id: z.null(),
    receipt_digest: z.null(),
  })
  .strict();

const declaredReceiptReferenceSchema = z
  .object({
    status: z.literal("declared_reference"),
    receipt_id: z.string().min(1),
    receipt_digest: sha256DigestSchema,
  })
  .strict();

export const guardrailObservationSchema = z
  .object({
    schema_version: z.literal("ghostark.research.guardrail_observation.v1"),
    observation_id: z.string().regex(/^gobs_[A-Za-z0-9_-]+$/),
    observed_at: z.string().datetime(),
    scope: z
      .object({
        tenant_id_hash: hmacSha256DigestSchema,
        request_id_hash: hmacSha256DigestSchema,
      })
      .strict(),
    guardrail: z
      .object({
        guardrail_id: z.string().min(1),
        guardrail_version: z.string().min(1),
        evaluation_stage: z.enum([
          "pre_model",
          "retrieval",
          "post_model",
          "tool_input",
          "tool_output",
        ]),
      })
      .strict(),
    result: z
      .object({
        outcome: z.enum(["pass", "block", "redact", "flag", "error"]),
        action: z.enum([
          "allow",
          "block",
          "redact",
          "queue_review",
          "fail_closed",
        ]),
        scores: z.array(guardrailScoreSchema),
        findings: z.array(guardrailFindingSchema),
      })
      .strict()
      .refine(
        (result) => result.scores.length > 0 || result.findings.length > 0,
        "guardrail result must include at least one score or finding",
      ),
    content_evidence: z
      .object({
        input_digest: sha256DigestSchema,
        output_digest: sha256DigestSchema.nullable(),
        raw_content_included: z.literal(false),
      })
      .strict(),
    privacy: z
      .object({
        classification: z.enum(["metadata_only", "pseudonymous"]),
        redaction_applied: z.literal(true),
        redaction_policy_id: z.string().min(1),
        redaction_policy_digest: sha256DigestSchema,
        suppressed_fields: z
          .array(
            z.enum([
              "prompt",
              "completion",
              "retrieved_context",
              "tool_arguments",
              "tool_result",
              "user_identifier",
            ]),
          )
          .min(1),
      })
      .strict(),
    receipt_binding: z.discriminatedUnion("status", [
      unboundReceiptReferenceSchema,
      declaredReceiptReferenceSchema,
    ]),
    telemetry: z
      .object({
        trace_id: z.string().regex(/^[a-f0-9]{32}$/).nullable(),
        span_id: z.string().regex(/^[a-f0-9]{16}$/).nullable(),
      })
      .strict()
      .refine(
        (telemetry) =>
          (telemetry.trace_id === null && telemetry.span_id === null) ||
          (telemetry.trace_id !== null && telemetry.span_id !== null),
        "telemetry trace_id and span_id must both be present or both be null",
      ),
    non_claims: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type GuardrailObservation = z.infer<typeof guardrailObservationSchema>;

export type GuardrailTelemetryAttributes = Record<
  string,
  string | number | boolean
>;

export function validateGuardrailObservation(
  value: unknown,
): GuardrailObservation {
  return guardrailObservationSchema.parse(value);
}

export function toGuardrailTelemetryAttributes(
  value: unknown,
  options: { includePseudonymousScope?: boolean } = {},
): GuardrailTelemetryAttributes {
  const observation = validateGuardrailObservation(value);
  const attributes: GuardrailTelemetryAttributes = {
    "ghostark.schema_version": observation.schema_version,
    "ghostark.guardrail.observation_id": observation.observation_id,
    "ghostark.guardrail.id": observation.guardrail.guardrail_id,
    "ghostark.guardrail.version": observation.guardrail.guardrail_version,
    "ghostark.guardrail.evaluation_stage":
      observation.guardrail.evaluation_stage,
    "ghostark.guardrail.outcome": observation.result.outcome,
    "ghostark.guardrail.action": observation.result.action,
    "ghostark.guardrail.score_count": observation.result.scores.length,
    "ghostark.guardrail.finding_count": observation.result.findings.length,
    "ghostark.privacy.classification": observation.privacy.classification,
    "ghostark.privacy.redaction_applied":
      observation.privacy.redaction_applied,
    "ghostark.receipt.binding_status": observation.receipt_binding.status,
  };

  if (options.includePseudonymousScope === true) {
    attributes["ghostark.tenant.id_hash"] =
      observation.scope.tenant_id_hash;
    attributes["ghostark.request.id_hash"] =
      observation.scope.request_id_hash;
  }

  return attributes;
}
