import { describe, expect, it } from "vitest";
import { assertTrustedTenantSource } from "../../../../packages/enforcement-runtime/src/tenancy/trustedTenantSource";

const registry = JSON.stringify([
  {
    kind: "s3",
    tenantSlug: "acme-lab",
    sourceName: "raw-bucket",
    keyPrefix: "tenants/acme-lab/raw/"
  },
  {
    kind: "sqs",
    tenantSlug: "beta-lab",
    sourceArn: "arn:aws:sqs:us-east-1:111122223333:beta-fan-in"
  }
]);

describe("trusted tenant source assertion", () => {
  it("accepts a declared tenant only when source and namespace prefix match", () => {
    const tenantSlug = assertTrustedTenantSource(
      {
        kind: "s3",
        declaredTenantSlug: "acme-lab",
        sourceName: "raw-bucket",
        key: "tenants/acme-lab/raw/object.json"
      },
      { GHOST_ARK_TRUSTED_TENANT_SOURCES: registry }
    );

    expect(tenantSlug).toBe("acme-lab");
  });

  it("rejects cross-tenant keys on a trusted source", () => {
    expect(() =>
      assertTrustedTenantSource(
        {
          kind: "s3",
          declaredTenantSlug: "acme-lab",
          sourceName: "raw-bucket",
          key: "tenants/beta-lab/raw/object.json"
        },
        { GHOST_ARK_TRUSTED_TENANT_SOURCES: registry }
      )
    ).toThrow(/not trusted/u);
  });

  it("rejects message tenant slugs that do not match the authenticated queue arn", () => {
    expect(() =>
      assertTrustedTenantSource(
        {
          kind: "sqs",
          declaredTenantSlug: "acme-lab",
          sourceArn: "arn:aws:sqs:us-east-1:111122223333:beta-fan-in"
        },
        { GHOST_ARK_TRUSTED_TENANT_SOURCES: registry }
      )
    ).toThrow(/not trusted/u);
  });

  it("fails closed when the registry is absent", () => {
    expect(() =>
      assertTrustedTenantSource({
        kind: "s3",
        declaredTenantSlug: "acme-lab",
        sourceName: "raw-bucket",
        key: "tenants/acme-lab/raw/object.json"
      })
    ).toThrow(/Missing trusted tenant source registry/u);
  });
});
