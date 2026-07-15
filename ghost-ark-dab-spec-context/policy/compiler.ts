import { ValidationError } from "../../../shared/src/errors";
import { mostRestrictiveDecision } from "./decisions";
import { canonicalPolicyHash } from "./canonical";
import {
  CompiledPolicy,
  CompiledPolicyRule,
  PolicyLayer,
  PolicySource,
  policySourceSchema
} from "./schema";

export const layerPrecedence: Record<PolicyLayer, number> = {
  default: 0,
  user: 1,
  organization: 2,
  regulated: 3,
  emergency: 4
};

export interface CompilePolicySetInput {
  policies: unknown[];
}

function sourceSortKey(policy: PolicySource): string {
  return `${layerPrecedence[policy.layer]}:${policy.layer}:${policy.policyId}:${policy.version}`;
}

function ruleSortKey(rule: CompiledPolicyRule): string {
  return [
    rule.phase,
    String(layerPrecedence[rule.layer]).padStart(2, "0"),
    rule.sourcePolicyId,
    rule.sourceVersion,
    rule.id
  ].join(":");
}

export function validatePolicySource(value: unknown): PolicySource {
  const parsed = policySourceSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid policy source", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function compilePolicySet(input: CompilePolicySetInput): CompiledPolicy {
  const policies = input.policies.map(validatePolicySource).sort((left, right) => {
    const leftKey = sourceSortKey(left);
    const rightKey = sourceSortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  if (policies.length === 0) {
    throw new ValidationError("At least one policy source is required");
  }

  const rules = policies
    .flatMap((policy) =>
      policy.rules.map(
        (rule): CompiledPolicyRule => ({
          ...rule,
          canonicalRuleId: `${policy.layer}:${policy.policyId}:${policy.version}:${rule.id}`,
          sourcePolicyId: policy.policyId,
          sourceVersion: policy.version,
          layer: policy.layer
        })
      )
    )
    .sort((left, right) => {
      const leftKey = ruleSortKey(left);
      const rightKey = ruleSortKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  const withoutHash: Omit<CompiledPolicy, "policyHash"> = {
    schemaVersion: "ghost.compiled_policy.v1",
    compilerVersion: "ghost-policy-compiler-ts.1",
    policyVersion: policies.map((policy) => `${policy.layer}:${policy.policyId}@${policy.version}`).join("+"),
    defaultDecision: mostRestrictiveDecision(policies.map((policy) => policy.defaultDecision)),
    unknownRiskDecision: mostRestrictiveDecision(policies.map((policy) => policy.unknownRiskDecision)),
    rules
  };

  return {
    ...withoutHash,
    policyHash: canonicalPolicyHash(withoutHash)
  };
}
