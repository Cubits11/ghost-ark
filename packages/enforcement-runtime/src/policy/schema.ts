import { z } from "zod";
import { consentStateSchema, decisionKindSchema, enforcementPhaseSchema } from "./decisions";

export const policyLayers = ["default", "user", "organization", "regulated", "emergency"] as const;
export const policyLayerSchema = z.enum(policyLayers);
export type PolicyLayer = z.infer<typeof policyLayerSchema>;

export const memoryTierLiterals = ["KAPPA", "SESSION", "CONSTITUTION", "AUDIT", "RESTRICTED"] as const;
export const memoryTierLiteralSchema = z.enum(memoryTierLiterals);
export type PolicyMemoryTier = z.infer<typeof memoryTierLiteralSchema>;

export const retrievalTaintSchema = z.enum(["trusted", "untrusted_instruction", "cross_tenant", "unknown_origin"]);
export type RetrievalTaint = z.infer<typeof retrievalTaintSchema>;

export const policyRuleMatchSchema = z
  .object({
    textContainsAny: z.array(z.string().min(1)).optional(),
    outputContainsAny: z.array(z.string().min(1)).optional(),
    riskTagsAny: z.array(z.string().min(1)).optional(),
    retrievalTaintAny: z.array(retrievalTaintSchema).optional(),
    memoryTierAny: z.array(memoryTierLiteralSchema).optional(),
    memoryClassificationAny: z.array(z.string().min(1)).optional(),
    consentStateAny: z.array(consentStateSchema).optional(),
    requiresConsent: z.boolean().optional(),
    bodyDeclaredTenant: z.boolean().optional()
  })
  .default({});

export type PolicyRuleMatch = z.infer<typeof policyRuleMatchSchema>;

export const policyRuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,96}$/u),
  description: z.string().optional(),
  phase: enforcementPhaseSchema,
  decision: decisionKindSchema,
  riskScore: z.number().min(0).max(1).default(0),
  actionTaken: z.array(z.string().min(1)).default([]),
  match: policyRuleMatchSchema
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;

export const policySourceSchema = z.object({
  schemaVersion: z.literal("ghost.policy.v1"),
  policyId: z.string().regex(/^[a-z][a-z0-9._-]{1,96}$/u),
  version: z.string().min(1),
  layer: policyLayerSchema,
  defaultDecision: decisionKindSchema.default("ALLOW"),
  unknownRiskDecision: decisionKindSchema.default("REQUIRE_CONSENT"),
  rules: z.array(policyRuleSchema).default([])
});

export type PolicySource = z.infer<typeof policySourceSchema>;

export interface CompiledPolicyRule extends PolicyRule {
  canonicalRuleId: string;
  sourcePolicyId: string;
  sourceVersion: string;
  layer: PolicyLayer;
}

export interface CompiledPolicy {
  schemaVersion: "ghost.compiled_policy.v1";
  compilerVersion: "ghost-policy-compiler-ts.1";
  policyVersion: string;
  policyHash: string;
  defaultDecision: z.infer<typeof decisionKindSchema>;
  unknownRiskDecision: z.infer<typeof decisionKindSchema>;
  rules: CompiledPolicyRule[];
}

export interface IdentityForPolicy {
  tenantId: string;
  userId: string;
  role?: string;
  sessionId: string;
  requestId: string;
}

export interface RetrievedContextForPolicy {
  tenantId: string;
  digest: string;
  taint: RetrievalTaint[];
}

export interface MemoryWriteForPolicy {
  tier: PolicyMemoryTier;
  classificationTags: string[];
  contentDigest?: string;
}

export interface PolicyEvaluationContext {
  phase: z.infer<typeof enforcementPhaseSchema>;
  identity: IdentityForPolicy;
  requestText?: string;
  outputText?: string;
  riskTags?: string[];
  retrievedContext?: RetrievedContextForPolicy[];
  memoryWrite?: MemoryWriteForPolicy;
  consentState?: z.infer<typeof consentStateSchema>;
  bodyDeclaredTenant?: boolean;
}
