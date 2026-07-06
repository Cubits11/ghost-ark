import { z } from "zod";
import { lineageEventIdFromPayload } from "../../receipt-schema/src/hashCanonicalization";
import { tenantSlugSchema } from "../../receipt-schema/src/receipt";
import { ValidationError } from "../../shared/src/errors";

export const lineageEventTypeSchema = z.enum([
  "ingested",
  "normalized",
  "curated",
  "cataloged",
  "queried",
  "signed",
  "indexed",
  "exported",
  "replayed",
  "revoked"
]);

export const lineageEventSchema = z.object({
  eventId: z.string().regex(/^lin_[a-f0-9]{64}$/u),
  tenantSlug: tenantSlugSchema,
  eventType: lineageEventTypeSchema,
  occurredAt: z.string().datetime(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  actor: z.string().min(1),
  runId: z.string().optional(),
  metadata: z.record(z.unknown()).default({})
});

export type LineageEventType = z.infer<typeof lineageEventTypeSchema>;
export type LineageEvent = z.infer<typeof lineageEventSchema>;

export interface BuildLineageEventInput {
  tenantSlug: string;
  eventType: LineageEventType;
  inputs?: string[];
  outputs?: string[];
  actor: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export function buildLineageEvent(input: BuildLineageEventInput): LineageEvent {
  const withoutId = {
    tenantSlug: input.tenantSlug,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    inputs: [...(input.inputs ?? [])].sort(),
    outputs: [...(input.outputs ?? [])].sort(),
    actor: input.actor,
    runId: input.runId,
    metadata: input.metadata ?? {}
  };
  return validateLineageEvent({ eventId: lineageEventIdFromPayload(withoutId), ...withoutId });
}

export function validateLineageEvent(value: unknown): LineageEvent {
  const parsed = lineageEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid lineage event", { issues: parsed.error.issues });
  }
  return parsed.data;
}
