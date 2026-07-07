import { describe, expect, it } from "vitest";
import { compilePolicySet } from "../../../../packages/enforcement-runtime/src/policy/compiler";
import { canonicalPolicyHash } from "../../../../packages/enforcement-runtime/src/policy/canonical";

describe("policy compiler", () => {
  it("produces a stable canonical policy hash across object key ordering", () => {
    const left = compilePolicySet({
      policies: [
        {
          schemaVersion: "ghost.policy.v1",
          policyId: "org-minimal",
          version: "1.0.0",
          layer: "organization",
          rules: [
            {
              id: "refuse-private-memory",
              phase: "pre_model",
              decision: "REFUSE",
              match: { riskTagsAny: ["private_memory_extraction"] }
            }
          ]
        }
      ]
    });

    const right = compilePolicySet({
      policies: [
        {
          rules: [
            {
              match: { riskTagsAny: ["private_memory_extraction"] },
              decision: "REFUSE",
              phase: "pre_model",
              id: "refuse-private-memory"
            }
          ],
          layer: "organization",
          version: "1.0.0",
          policyId: "org-minimal",
          schemaVersion: "ghost.policy.v1"
        }
      ]
    });

    expect(left.policyHash).toBe(right.policyHash);
    expect(canonicalPolicyHash(left)).toBe(left.policyHash);
  });

  it("rejects untyped policy rules before evaluation", () => {
    expect(() =>
      compilePolicySet({
        policies: [
          {
            schemaVersion: "ghost.policy.v1",
            policyId: "bad-policy",
            version: "1.0.0",
            layer: "organization",
            rules: [{ id: "bad", phase: "before_llm", decision: "ALLOW" }]
          }
        ]
      })
    ).toThrow(/Invalid policy source/u);
  });
});
