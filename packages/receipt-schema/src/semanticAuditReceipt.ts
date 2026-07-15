import { z } from "zod";
import { ValidationError } from "../../shared/src/errors";

export const agentIdentitySchema = z.object({
  principal_arn: z.string(),
  model_version: z.string(),
  nitro_enclave_pcr0: z.string().optional()
});

export const ledgerGateSchema = z.object({
  status: z.enum(["PASSED", "FAILED_REPLAY", "FAILED_LIVENESS"]),
  consumed_nonces: z.array(z.string())
});

export const occGateSchema = z.object({
  status: z.enum(["PASSED", "FAILED_STATE_MISMATCH"]),
  read_set_projection_pi_R: z.array(z.string()),
  hash_sigma_0: z.string(),
  hash_sigma_now: z.string()
});

export const semanticGateSchema = z.object({
  status: z.enum(["PASSED", "FAILED_DRIFT_BOUNDS"]),
  step_probabilities: z.array(z.number().min(0).max(1)),
  cumulative_failure_bound: z.number().min(0).max(1),
  policy_threshold: z.number().min(0).max(1)
});

export const validationGatesSchema = z.object({
  ledger_gate: ledgerGateSchema,
  occ_gate: occGateSchema,
  semantic_gate: semanticGateSchema
});

export const semanticAuditReceiptSchema = z.object({
  transaction_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  agent_identity: agentIdentitySchema,
  trace_length: z.number().int().min(1),
  validation_gates: validationGatesSchema,
  commit_status: z.enum(["COMMITTED_TO_PHYSICAL", "SPECULATIVE_COLLAPSE"]),
  cryptographic_signature: z.string()
});

export type AgentIdentity = z.infer<typeof agentIdentitySchema>;
export type LedgerGate = z.infer<typeof ledgerGateSchema>;
export type OccGate = z.infer<typeof occGateSchema>;
export type SemanticGate = z.infer<typeof semanticGateSchema>;
export type ValidationGates = z.infer<typeof validationGatesSchema>;
export type SemanticAuditReceipt = z.infer<typeof semanticAuditReceiptSchema>;

export function validateSemanticAuditReceipt(value: unknown): SemanticAuditReceipt {
  const parsed = semanticAuditReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid semantic audit receipt", { issues: parsed.error.issues });
  }
  return parsed.data;
}
