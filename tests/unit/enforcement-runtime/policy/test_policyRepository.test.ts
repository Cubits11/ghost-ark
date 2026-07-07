import { describe, expect, it } from "vitest";
import { compilePolicySet } from "../../../../packages/enforcement-runtime/src/policy/compiler";
import { InMemoryPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { DEFAULT_GOVERNED_INVOKE_POLICY } from "../../../../packages/enforcement-runtime/src/policy/repository";
import { PolicySource } from "../../../../packages/enforcement-runtime/src/policy/schema";

const tenantPolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "tenant-a-policy",
  version: "1.0.0",
  layer: "organization",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "tenant-a-rule",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.4,
      actionTaken: ["test"],
      match: { textContainsAny: ["blocked"] }
    }
  ]
};

describe("policy repository", () => {
  it("returns an explicit conservative default policy when no tenant policy exists", async () => {
    const repository = new InMemoryPolicyRepository();
    const policies = await repository.loadPolicies({ tenantId: "tenant-a", userId: "user-a" });
    const compiled = compilePolicySet({ policies });

    expect(policies).toEqual([DEFAULT_GOVERNED_INVOKE_POLICY]);
    expect(compiled.policyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(compiled.unknownRiskDecision).toBe("REQUIRE_CONSENT");
  });

  it("loads only the requested tenant policy", async () => {
    const repository = new InMemoryPolicyRepository();
    repository.putTenantPolicies("tenant-a", [tenantPolicy]);

    expect((await repository.loadPolicies({ tenantId: "tenant-a", userId: "user-a" }))[0].policyId).toBe("tenant-a-policy");
    expect((await repository.loadPolicies({ tenantId: "tenant-b", userId: "user-b" }))[0].policyId).toBe("governed-invoke-default");
  });
});
