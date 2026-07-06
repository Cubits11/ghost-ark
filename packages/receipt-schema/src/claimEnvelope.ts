import { z } from "zod";
import { claimIdFromPayload } from "./hashCanonicalization";
import { tenantSlugSchema } from "./receipt";
import { ValidationError } from "../../shared/src/errors";

export const claimStateSchema = z.enum(["draft", "under-review", "accepted", "disputed", "revoked", "superseded"]);

export const claimEnvelopeSchema = z.object({
  claimId: z.string().regex(/^clm_[a-f0-9]{64}$/u),
  tenantSlug: tenantSlugSchema,
  state: claimStateSchema,
  statement: z.string().min(1),
  scope: z.string().optional(),
  receiptIds: z.array(z.string().regex(/^rct_[a-f0-9]{64}$/u)).default([]),
  reviewer: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({})
});

export type ClaimState = z.infer<typeof claimStateSchema>;
export type ClaimEnvelope = z.infer<typeof claimEnvelopeSchema>;

export interface BuildClaimEnvelopeInput {
  tenantSlug: string;
  statement: string;
  scope?: string;
  receiptIds?: string[];
  reviewer?: string;
  state?: ClaimState;
  metadata?: Record<string, unknown>;
  now?: string;
}

export function buildClaimEnvelope(input: BuildClaimEnvelopeInput): ClaimEnvelope {
  const now = input.now ?? new Date().toISOString();
  const withoutId = {
    tenantSlug: input.tenantSlug,
    statement: input.statement,
    scope: input.scope,
    receiptIds: [...(input.receiptIds ?? [])].sort(),
    reviewer: input.reviewer,
    state: input.state ?? "draft",
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {}
  };
  const claimId = claimIdFromPayload(withoutId);
  return validateClaimEnvelope({ claimId, ...withoutId });
}

export function validateClaimEnvelope(value: unknown): ClaimEnvelope {
  const parsed = claimEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid claim envelope", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function transitionClaimState(claim: ClaimEnvelope, state: ClaimState, reviewer?: string): ClaimEnvelope {
  if (claim.state === "revoked" && state !== "revoked") {
    throw new ValidationError("Revoked claims cannot transition back to an active state", {
      claimId: claim.claimId,
      from: claim.state,
      to: state
    });
  }
  return validateClaimEnvelope({
    ...claim,
    state,
    reviewer: reviewer ?? claim.reviewer,
    updatedAt: new Date().toISOString()
  });
}
