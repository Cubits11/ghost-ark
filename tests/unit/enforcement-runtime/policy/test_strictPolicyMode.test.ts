import { describe, expect, it, vi } from "vitest";
import { DynamoDbPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/dynamodbPolicyRepository";
import { DEFAULT_GOVERNED_INVOKE_POLICY } from "../../../../packages/enforcement-runtime/src/policy/repository";
import { compilePolicySet } from "../../../../packages/enforcement-runtime/src/policy/compiler";
import { governedPolicySeedItem, defaultGovernedInvokeSeedPolicy } from "../../../../tools/scripts/seedGovernedPolicy";

function mockClient(itemsByPk: Record<string, unknown[]>) {
  return {
    send: vi.fn(async (command: { input?: { ExpressionAttributeValues?: Record<string, string> } }) => {
      const pk = command.input?.ExpressionAttributeValues?.[":pk"] ?? "";
      return { Items: itemsByPk[pk] ?? [] };
    })
  };
}

describe("strict governed invoke policy mode", () => {
  it("fails closed when no DynamoDB policy exists and default policy is disabled", async () => {
    const repository = new DynamoDbPolicyRepository({
      tableName: "policies",
      client: mockClient({}) as never,
      allowDefaultPolicy: false
    });

    await expect(repository.loadPolicies({ tenantId: "tenant-a", userId: "user-a" })).rejects.toThrow(/No active governed invoke policy/u);
  });

  it("returns the default policy when explicitly allowed", async () => {
    const repository = new DynamoDbPolicyRepository({
      tableName: "policies",
      client: mockClient({}) as never,
      allowDefaultPolicy: true
    });

    await expect(repository.loadPolicies({ tenantId: "tenant-a", userId: "user-a" })).resolves.toEqual([DEFAULT_GOVERNED_INVOKE_POLICY]);
  });

  it("builds the seeded tenant policy item shape and compiles the seeded policy", () => {
    const item = governedPolicySeedItem({
      tenant: "tenant-a",
      policy: defaultGovernedInvokeSeedPolicy,
      stage: "dev",
      now: "2026-07-07T12:00:00.000Z"
    });
    const compiled = compilePolicySet({ policies: [item.policySource] });

    expect(item).toMatchObject({
      PK: "TENANT#tenant-a",
      SK: "POLICY#tenant-governed-invoke-baseline#1.0.0",
      tenantId: "tenant-a",
      active: true,
      stage: "dev"
    });
    expect(item.policyHash).toBe(compiled.policyHash);
  });

  it("does not load tenant B seeded policy for tenant A", async () => {
    const tenantBItem = governedPolicySeedItem({
      tenant: "tenant-b",
      policy: defaultGovernedInvokeSeedPolicy,
      now: "2026-07-07T12:00:00.000Z"
    });
    const repository = new DynamoDbPolicyRepository({
      tableName: "policies",
      client: mockClient({ "TENANT#tenant-b": [tenantBItem] }) as never,
      allowDefaultPolicy: false
    });

    await expect(repository.loadPolicies({ tenantId: "tenant-a", userId: "user-a" })).rejects.toThrow(/No active governed invoke policy/u);
  });
});
