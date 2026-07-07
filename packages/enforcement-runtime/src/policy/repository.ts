import { PolicySource } from "./schema";

export interface PolicyRepositoryLoadInput {
  tenantId: string;
  userId: string;
  role?: string;
}

export interface PolicyRepository {
  loadPolicies(input: PolicyRepositoryLoadInput): Promise<PolicySource[]>;
}

export const DEFAULT_GOVERNED_INVOKE_POLICY: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "governed-invoke-default",
  version: "1.0.0",
  layer: "default",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "private-memory-extraction",
      description: "Refuse direct attempts to extract private memory.",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.95,
      actionTaken: ["block_model_invocation"],
      match: { textContainsAny: ["extract private memory", "reveal private memory"] }
    },
    {
      id: "cross-tenant-retrieval",
      description: "Refuse model invocation when cross-tenant retrieval contamination is detected.",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 1,
      actionTaken: ["block_model_invocation", "quarantine_retrieval"],
      match: { riskTagsAny: ["retrieval_cross_tenant"] }
    },
    {
      id: "post-model-pii-redaction",
      description: "Redact obvious private identifiers or credential-like material in model output.",
      phase: "post_model",
      decision: "REDACT",
      riskScore: 0.7,
      actionTaken: ["redact_output"],
      match: { outputContainsAny: ["email:", "password", "secret", "api key"] }
    },
    {
      id: "restricted-memory-consent",
      description: "Restricted memory requires explicit consent.",
      phase: "memory_write",
      decision: "REQUIRE_CONSENT",
      riskScore: 0.8,
      actionTaken: ["request_explicit_consent"],
      match: { memoryTierAny: ["RESTRICTED"], requiresConsent: true }
    },
    {
      id: "sensitive-memory-suppression",
      description: "Suppress credential-like or sensitive memory writes.",
      phase: "memory_write",
      decision: "MEMORY_SUPPRESS",
      riskScore: 0.9,
      actionTaken: ["drop_memory_write"],
      match: { memoryClassificationAny: ["credential", "secret", "sensitive"] }
    }
  ]
};
