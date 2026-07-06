import { describe, expect, it } from "vitest";
import { compileTenantNamespace, normalizeTenantSlug } from "../../../packages/policy-compiler/src/tenantNamespace";
import { compileTenantSandboxPolicy } from "../../../packages/policy-compiler/src/iamPolicies";

describe("tenant namespace compiler", () => {
  it("normalizes valid slugs and rejects invalid outputs", () => {
    expect(normalizeTenantSlug("Acme Lab")).toBe("acme-lab");
  });

  it("compiles deterministic resource names", () => {
    const namespace = compileTenantNamespace({
      stage: "dev",
      tenantSlug: "acme-lab",
      rawBucket: "raw",
      curatedBucket: "curated",
      exportBucket: "exports",
      resultsBucket: "results",
      region: "us-east-1"
    });
    expect(namespace.glue.databaseName).toBe("ghost_ark_dev_acme_lab");
    expect(namespace.s3.rawPrefix).toBe("s3://raw/tenants/acme-lab/raw/");
  });

  it("emits principal-tag IAM scoping", () => {
    const policy = compileTenantSandboxPolicy({
      stage: "dev",
      tenantSlug: "acme-lab",
      rawBucket: "raw",
      curatedBucket: "curated",
      exportBucket: "exports",
      resultsBucket: "results",
      region: "us-east-1",
      accountId: "123456789012",
      allowedRegions: ["us-east-1"],
      tenantServiceRoleArn: "arn:aws:iam::123456789012:role/ghost-ark-dev-tenant-service-role"
    });
    expect(JSON.stringify(policy.document)).toContain("${aws:PrincipalTag/slug}");
    expect(policy.hash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
