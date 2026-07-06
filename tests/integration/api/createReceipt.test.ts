import { describe, expect, it } from "vitest";
import { buildReceiptPayload } from "../../../packages/receipt-schema/src/receipt";

describe("receipt API contract", () => {
  it("requires at least one evidence object", () => {
    expect(() =>
      buildReceiptPayload({
        tenantSlug: "acme-lab",
        subject: { kind: "dataset-version", id: "empty" },
        evidenceObjects: [],
        governanceContext: {
          lakeFormationTags: { tenant_slug: "acme-lab" },
          columnRestrictions: [],
          policyCompilerVersion: "50.0.0"
        }
      })
    ).toThrow(/Invalid receipt payload/u);
  });
});
