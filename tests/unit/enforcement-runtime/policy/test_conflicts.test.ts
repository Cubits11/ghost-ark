import { describe, expect, it } from "vitest";
import { compilePolicySet } from "../../../../packages/enforcement-runtime/src/policy/compiler";
import { decisionAtLeastAsRestrictiveAs } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import { evaluatePolicy } from "../../../../packages/enforcement-runtime/src/policy/evaluator";
import { PolicySource } from "../../../../packages/enforcement-runtime/src/policy/schema";

const identity = {
  tenantId: "tenant-a",
  userId: "user-a",
  sessionId: "session-a",
  requestId: "request-a"
};

const userPolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "user-minimal",
  version: "1.0.0",
  layer: "user",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "allow-recall",
      phase: "pre_model",
      decision: "ALLOW",
      riskScore: 0,
      actionTaken: [],
      match: { riskTagsAny: ["private_memory_extraction"] }
    }
  ]
};

const orgPolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "org-minimal",
  version: "1.0.0",
  layer: "organization",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "refuse-private-memory",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.95,
      actionTaken: ["block_model_invocation"],
      match: { riskTagsAny: ["private_memory_extraction"] }
    }
  ]
};

describe("policy conflict handling", () => {
  it("resolves org/user conflict to the deterministic stricter result", () => {
    const compiled = compilePolicySet({ policies: [userPolicy, orgPolicy] });
    const decision = evaluatePolicy(compiled, {
      phase: "pre_model",
      identity,
      riskTags: ["private_memory_extraction"]
    });

    expect(decision.decision).toBe("REFUSE");
    expect(decision.matchedRuleIds).toEqual([
      "organization:org-minimal:1.0.0:refuse-private-memory",
      "user:user-minimal:1.0.0:allow-recall"
    ]);
  });

  it("keeps monotonic stricter policy cases from becoming less restrictive", () => {
    const baseline = compilePolicySet({ policies: [userPolicy] });
    const stricter = compilePolicySet({ policies: [userPolicy, orgPolicy] });
    const context = {
      phase: "pre_model" as const,
      identity,
      riskTags: ["private_memory_extraction"]
    };

    const baselineDecision = evaluatePolicy(baseline, context).decision;
    const stricterDecision = evaluatePolicy(stricter, context).decision;

    expect(decisionAtLeastAsRestrictiveAs(stricterDecision, baselineDecision)).toBe(true);
  });
});
