import { describe, expect, it } from "vitest";
import { parseSeedGovernedPolicyArgs, governedPolicySeedItem, defaultGovernedInvokeSeedPolicy } from "../../../tools/scripts/seedGovernedPolicy";
import { parseSmokeGovernedInvokeArgs } from "../../../tools/scripts/smokeGovernedInvoke";

describe("governed invoke scripts", () => {
  it("parses seed policy arguments", () => {
    expect(parseSeedGovernedPolicyArgs(["--table", "policies", "--tenant", "acme-lab", "--stage", "dev"])).toMatchObject({
      table: "policies",
      tenant: "acme-lab",
      stage: "dev"
    });
  });

  it("throws when seed policy required arguments are missing", () => {
    expect(() => parseSeedGovernedPolicyArgs(["--tenant", "acme-lab"])).toThrow(/--table/u);
  });

  it("builds a conservative active policy item", () => {
    const item = governedPolicySeedItem({
      tenant: "acme-lab",
      policy: defaultGovernedInvokeSeedPolicy,
      now: "2026-07-07T12:00:00.000Z"
    });

    expect(item.PK).toBe("TENANT#acme-lab");
    expect(item.active).toBe(true);
    expect(item.policySource.rules.map((rule) => rule.id)).toContain("block-cross-tenant-retrieval");
    expect(item.policyHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("parses smoke invoke arguments without exposing token values", () => {
    const args = parseSmokeGovernedInvokeArgs([
      "--api",
      "https://api.example.test",
      "--token",
      "secret-token",
      "--tenant",
      "acme-lab",
      "--model",
      "anthropic.claude-test"
    ]);

    expect(args).toEqual({
      api: "https://api.example.test",
      token: "secret-token",
      tenant: "acme-lab",
      model: "anthropic.claude-test"
    });
  });
});
