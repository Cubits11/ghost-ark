import { compareDecisionRestrictiveness, DecisionKind, PolicyDecision } from "./decisions";
import { layerPrecedence } from "./compiler";
import { CompiledPolicy, CompiledPolicyRule, PolicyEvaluationContext } from "./schema";

function includesText(haystack: string | undefined, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) {
    return true;
  }
  const lowerHaystack = (haystack ?? "").toLowerCase();
  return needles.some((needle) => lowerHaystack.includes(needle.toLowerCase()));
}

function intersects<T>(left: T[] | undefined, right: T[] | undefined): boolean {
  if (!right || right.length === 0) {
    return true;
  }
  const leftSet = new Set(left ?? []);
  return right.some((value) => leftSet.has(value));
}

function hasUnknownRisk(context: PolicyEvaluationContext): boolean {
  return (context.riskTags ?? []).some((tag) => ["unknown", "unknown_risk", "unclassified"].includes(tag));
}

function matchesRule(rule: CompiledPolicyRule, context: PolicyEvaluationContext): boolean {
  if (rule.phase !== context.phase) {
    return false;
  }

  const match = rule.match;
  if (!includesText(context.requestText, match.textContainsAny)) {
    return false;
  }
  if (!includesText(context.outputText, match.outputContainsAny)) {
    return false;
  }
  if (!intersects(context.riskTags, match.riskTagsAny)) {
    return false;
  }
  if (!intersects(context.memoryWrite?.classificationTags, match.memoryClassificationAny)) {
    return false;
  }
  if (match.memoryTierAny && !context.memoryWrite?.tier) {
    return false;
  }
  if (match.memoryTierAny && !match.memoryTierAny.includes(context.memoryWrite?.tier ?? "KAPPA")) {
    return false;
  }
  if (match.consentStateAny && !match.consentStateAny.includes(context.consentState ?? "missing")) {
    return false;
  }
  if (match.requiresConsent === true && context.consentState === "granted") {
    return false;
  }
  if (match.retrievalTaintAny) {
    const taints = (context.retrievedContext ?? []).flatMap((retrieved) => retrieved.taint);
    if (!intersects(taints, match.retrievalTaintAny)) {
      return false;
    }
  }
  if (match.bodyDeclaredTenant !== undefined && match.bodyDeclaredTenant !== (context.bodyDeclaredTenant === true)) {
    return false;
  }

  return true;
}

function chooseDecision(matches: CompiledPolicyRule[], fallback: DecisionKind): DecisionKind {
  return matches.reduce((current, rule) => {
    const compared = compareDecisionRestrictiveness(rule.decision, current);
    return compared > 0 ? rule.decision : current;
  }, fallback);
}

function winningRules(matches: CompiledPolicyRule[], decision: DecisionKind): CompiledPolicyRule[] {
  return matches
    .filter((rule) => rule.decision === decision)
    .sort((left, right) => {
      const layerDelta = layerPrecedence[right.layer] - layerPrecedence[left.layer];
      if (layerDelta !== 0) {
        return layerDelta;
      }
      return left.canonicalRuleId < right.canonicalRuleId ? -1 : left.canonicalRuleId > right.canonicalRuleId ? 1 : 0;
    });
}

export function evaluatePolicy(policy: CompiledPolicy, context: PolicyEvaluationContext): PolicyDecision {
  const matches = policy.rules.filter((rule) => matchesRule(rule, context));
  const fallback = matches.length > 0 ? policy.defaultDecision : hasUnknownRisk(context) ? policy.unknownRiskDecision : policy.defaultDecision;
  const decision = chooseDecision(matches, fallback);
  const winners = winningRules(matches, decision);
  const matchedLayers = [...new Set(matches.map((rule) => rule.layer))].sort();
  const actionTaken = [...new Set(matches.flatMap((rule) => rule.actionTaken))].sort();
  const maxRisk = matches.reduce((current, rule) => Math.max(current, rule.riskScore), hasUnknownRisk(context) ? 0.5 : 0);
  const reasons =
    winners.length > 0
      ? winners.map((rule) => rule.description ?? rule.canonicalRuleId)
      : [hasUnknownRisk(context) ? "unknown risk default" : "policy default"];

  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase: context.phase,
    decision,
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
    matchedRuleIds: matches.map((rule) => rule.canonicalRuleId).sort(),
    matchedLayers,
    actionTaken,
    riskScore: Number(maxRisk.toFixed(4)),
    reasons
  };
}
