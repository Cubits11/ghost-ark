import { z } from "zod";

export const decisionVocabulary = [
  "ALLOW",
  "MODIFY",
  "REDACT",
  "REFUSE",
  "SILENCE",
  "ESCALATE",
  "REQUIRE_CONSENT",
  "MEMORY_SUPPRESS",
  "RECEIPT_ONLY",
  "HUMAN_REVIEW"
] as const;

export const decisionKindSchema = z.enum(decisionVocabulary);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

export const enforcementPhases = [
  "pre_retrieval",
  "pre_model",
  "post_model",
  "memory_write",
  "final_response"
] as const;

export const enforcementPhaseSchema = z.enum(enforcementPhases);
export type EnforcementPhase = z.infer<typeof enforcementPhaseSchema>;

export const consentStates = ["granted", "denied", "missing", "not_required"] as const;
export const consentStateSchema = z.enum(consentStates);
export type ConsentState = z.infer<typeof consentStateSchema>;

export const decisionRank: Record<DecisionKind, number> = {
  ALLOW: 0,
  RECEIPT_ONLY: 1,
  MODIFY: 2,
  REDACT: 3,
  REQUIRE_CONSENT: 4,
  MEMORY_SUPPRESS: 5,
  ESCALATE: 6,
  HUMAN_REVIEW: 7,
  REFUSE: 8,
  SILENCE: 9
};

export function compareDecisionRestrictiveness(left: DecisionKind, right: DecisionKind): number {
  return decisionRank[left] - decisionRank[right];
}

export function mostRestrictiveDecision(decisions: DecisionKind[]): DecisionKind {
  if (decisions.length === 0) {
    return "ALLOW";
  }
  return decisions.reduce((current, candidate) =>
    compareDecisionRestrictiveness(candidate, current) > 0 ? candidate : current
  );
}

export interface PolicyDecision {
  schemaVersion: "ghost.policy.decision.v1";
  phase: EnforcementPhase;
  decision: DecisionKind;
  policyVersion: string;
  policyHash: string;
  matchedRuleIds: string[];
  matchedLayers: string[];
  actionTaken: string[];
  riskScore: number;
  reasons: string[];
}

export function decisionAtLeastAsRestrictiveAs(candidate: DecisionKind, baseline: DecisionKind): boolean {
  return compareDecisionRestrictiveness(candidate, baseline) >= 0;
}
