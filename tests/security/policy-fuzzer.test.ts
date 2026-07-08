import { describe, expect, it } from "vitest";
import { compileTenantSandboxPolicy } from "../../packages/policy-compiler/src/iamPolicies";
import { verifyTenantSandboxPolicyInvariants } from "../../packages/policy-compiler/src/invariants";
import { compileTenantNamespace, normalizeTenantSlug } from "../../packages/policy-compiler/src/tenantNamespace";

const baseInput = {
  stage: "dev",
  tenantSlug: "tenant-a",
  rawBucket: "raw",
  curatedBucket: "curated",
  exportBucket: "exports",
  resultsBucket: "results",
  region: "us-east-1",
  accountId: "123456789012",
  allowedRegions: ["us-east-1"],
  tenantServiceRoleArn: "arn:aws:iam::123456789012:role/ghost-ark-dev-tenant-service-role"
};

describe("policy compiler adversarial namespace fuzzing", () => {
  it.each([
    "../tenant-b",
    "tenant-a/../../tenant-b",
    "tenant-*",
    "tenant\" , \"Action\":\"*",
    "tenant${aws:PrincipalTag/slug}",
    "tenant`aws:username`",
    "tenant%2fsecret"
  ])("fails closed for hostile tenant slug %s", (tenantSlug) => {
    expect(() => normalizeTenantSlug(tenantSlug)).toThrow(/Invalid tenant slug/u);
    expect(() => compileTenantNamespace({ ...baseInput, tenantSlug })).toThrow(/Invalid tenant slug/u);
    expect(() => compileTenantSandboxPolicy({ ...baseInput, tenantSlug })).toThrow(/Invalid tenant slug/u);
  });

  it("proves emitted IAM stays within the tenant boundary", () => {
    const policy = compileTenantSandboxPolicy(baseInput);
    const namespace = compileTenantNamespace(baseInput);

    expect(
      verifyTenantSandboxPolicyInvariants({
        document: policy.document,
        namespace,
        accountId: baseInput.accountId,
        region: baseInput.region
      })
    ).toMatchObject({ passed: true, violations: [] });
  });

  it("detects wildcard and destructive receipt ledger grants in generated-policy ASTs", () => {
    const policy = compileTenantSandboxPolicy(baseInput);
    const namespace = compileTenantNamespace(baseInput);
    const tampered = {
      ...policy.document,
      Statement: [
        ...policy.document.Statement,
        {
          Sid: "InjectedPrivilegeEscalation",
          Effect: "Allow",
          Action: ["dynamodb:UpdateItem", "*"],
          Resource: [`arn:aws:dynamodb:${baseInput.region}:${baseInput.accountId}:table/ghost-ark-${baseInput.stage}-receipts`]
        }
      ]
    };

    const result = verifyTenantSandboxPolicyInvariants({
      document: tampered,
      namespace,
      accountId: baseInput.accountId,
      region: baseInput.region
    });

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("allow_wildcard_action");
    expect(result.violations.map((violation) => violation.code)).toContain("receipt_ledger_mutation");
  });

  it("rejects namespace bucket injection before ARN compilation", () => {
    expect(() => compileTenantSandboxPolicy({ ...baseInput, rawBucket: "raw/tenants/tenant-b" })).toThrow(
      /Invalid tenant namespace bucket name/u
    );
    expect(() => compileTenantSandboxPolicy({ ...baseInput, curatedBucket: "RawBucket" })).toThrow(
      /Invalid tenant namespace bucket name/u
    );
  });

  it("detects NotAction, NotResource, and wildcard destructive DynamoDB receipt grants", () => {
    const policy = compileTenantSandboxPolicy(baseInput);
    const namespace = compileTenantNamespace(baseInput);
    const receiptArn = `arn:aws:dynamodb:${baseInput.region}:${baseInput.accountId}:table/ghost-ark-${baseInput.stage}-receipts`;
    const tampered = {
      ...policy.document,
      Statement: [
        ...policy.document.Statement,
        {
          Sid: "InjectedInverseAllow",
          Effect: "Allow",
          NotAction: "iam:*",
          NotResource: receiptArn
        },
        {
          Sid: "InjectedDeleteWildcard",
          Effect: "Allow",
          Action: ["dynamodb:Delete*"],
          Resource: [receiptArn],
          Condition: {
            "ForAllValues:StringEquals": {
              "dynamodb:LeadingKeys": ["${aws:PrincipalTag/slug}"]
            }
          }
        }
      ]
    };

    const result = verifyTenantSandboxPolicyInvariants({
      document: tampered,
      namespace,
      accountId: baseInput.accountId,
      region: baseInput.region
    });

    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("allow_not_action_or_resource");
    expect(result.violations.map((violation) => violation.code)).toContain("allow_wildcard_action");
    expect(result.violations.map((violation) => violation.code)).toContain("receipt_ledger_mutation");
  });
});
