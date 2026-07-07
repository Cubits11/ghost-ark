import { describe, expect, it } from "vitest";
import { compilePolicySet } from "../../../../packages/enforcement-runtime/src/policy/compiler";
import { evaluatePolicy } from "../../../../packages/enforcement-runtime/src/policy/evaluator";
import { PolicyEvaluationContext, PolicySource } from "../../../../packages/enforcement-runtime/src/policy/schema";

const identity = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "user",
  sessionId: "session-a",
  requestId: "request-a"
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
      id: "private-memory-extraction",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.95,
      actionTaken: ["block_model_invocation"],
      match: { riskTagsAny: ["private_memory_extraction"] }
    },
    {
      id: "untrusted-retrieval-instruction",
      phase: "pre_model",
      decision: "ESCALATE",
      riskScore: 0.8,
      actionTaken: ["quarantine_retrieval"],
      match: { retrievalTaintAny: ["untrusted_instruction"] }
    },
    {
      id: "pii-redaction",
      phase: "post_model",
      decision: "REDACT",
      riskScore: 0.65,
      actionTaken: ["redact_output"],
      match: { outputContainsAny: ["ssn", "social security number", "email:"] }
    },
    {
      id: "restricted-memory-consent",
      phase: "memory_write",
      decision: "REQUIRE_CONSENT",
      riskScore: 0.7,
      actionTaken: ["request_explicit_consent"],
      match: { memoryTierAny: ["RESTRICTED"], requiresConsent: true }
    },
    {
      id: "sensitive-memory-suppression",
      phase: "memory_write",
      decision: "MEMORY_SUPPRESS",
      riskScore: 0.9,
      actionTaken: ["drop_memory_write"],
      match: { memoryClassificationAny: ["secret", "credential", "sensitive"] }
    }
  ]
};

function evaluate(context: Omit<PolicyEvaluationContext, "identity">) {
  return evaluatePolicy(compilePolicySet({ policies: [orgPolicy] }), { ...context, identity });
}

describe("deterministic policy evaluator", () => {
  it("allows a benign pre-model request", () => {
    expect(evaluate({ phase: "pre_model", requestText: "Summarize this public changelog." }).decision).toBe("ALLOW");
  });

  it("refuses direct private-memory extraction", () => {
    expect(evaluate({ phase: "pre_model", riskTags: ["private_memory_extraction"] }).decision).toBe("REFUSE");
  });

  it("redacts post-model output containing PII markers", () => {
    expect(evaluate({ phase: "post_model", outputText: "email: user@example.com" }).decision).toBe("REDACT");
  });

  it("requires consent before restricted memory writes", () => {
    expect(
      evaluate({
        phase: "memory_write",
        consentState: "missing",
        memoryWrite: { tier: "RESTRICTED", classificationTags: ["preference"] }
      }).decision
    ).toBe("REQUIRE_CONSENT");
  });

  it("suppresses sensitive memory writes", () => {
    expect(
      evaluate({
        phase: "memory_write",
        consentState: "granted",
        memoryWrite: { tier: "SESSION", classificationTags: ["credential"] }
      }).decision
    ).toBe("MEMORY_SUPPRESS");
  });

  it("escalates untrusted retrieved instructions", () => {
    expect(
      evaluate({
        phase: "pre_model",
        retrievedContext: [{ tenantId: "tenant-a", digest: "sha256:abc", taint: ["untrusted_instruction"] }]
      }).decision
    ).toBe("ESCALATE");
  });

  it("requires consent for unknown risk by policy default", () => {
    expect(evaluate({ phase: "pre_model", riskTags: ["unknown_risk"] }).decision).toBe("REQUIRE_CONSENT");
  });

  it("is deterministic for fixed inputs and compiled policy", () => {
    const compiled = compilePolicySet({ policies: [orgPolicy] });
    const context = { phase: "pre_model" as const, identity, riskTags: ["private_memory_extraction"] };
    expect(evaluatePolicy(compiled, context)).toEqual(evaluatePolicy(compiled, context));
  });
});
