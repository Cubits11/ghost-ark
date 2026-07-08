import { describe, expect, it } from "vitest";
import { IamPolicyDocument, compileTenantSandboxPolicy } from "../../../packages/policy-compiler/src/iamPolicies";
import { TenantNamespace, compileTenantNamespace } from "../../../packages/policy-compiler/src/tenantNamespace";
import {
  TenantBoundaryModel,
  buildTenantBoundaryModel,
  evaluateModeledPolicy,
  evaluateTenantBoundary,
  verifyNoTenantBoundaryCounterexample
} from "../../../packages/policy-compiler/src/formal/counterexampleEngine";

const tenantSlug = "acme-lab";
const accountId = "123456789012";

function namespace(): TenantNamespace {
  return compileTenantNamespace({
    stage: "dev",
    tenantSlug,
    rawBucket: "raw",
    curatedBucket: "curated",
    exportBucket: "exports",
    resultsBucket: "results",
    region: "us-east-1"
  });
}

function boundary(overrides: Partial<TenantBoundaryModel> = {}): TenantBoundaryModel {
  return {
    ...buildTenantBoundaryModel({ tenantSlug, namespace: namespace() }),
    ...overrides
  };
}

function generatedPolicy(): IamPolicyDocument {
  return compileTenantSandboxPolicy({
    stage: "dev",
    tenantSlug,
    rawBucket: "raw",
    curatedBucket: "curated",
    exportBucket: "exports",
    resultsBucket: "results",
    region: "us-east-1",
    accountId,
    allowedRegions: ["us-east-1"],
    tenantServiceRoleArn: `arn:aws:iam::${accountId}:role/ghost-ark-dev-${tenantSlug}-tenant-service-role`
  }).document;
}

function receiptTableArn(): string {
  return `arn:aws:dynamodb:us-east-1:${accountId}:table/ghost-ark-dev-receipts`;
}

function rawTenantObjectArn(slug = tenantSlug): string {
  return `arn:aws:s3:::raw/tenants/${slug}/raw/object.json`;
}

function policyWithStatement(statement: Record<string, unknown>): IamPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyMissingTenant",
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: { Null: { "aws:PrincipalTag/slug": "true" } }
      },
      statement
    ]
  };
}

describe("bounded tenant policy counterexample engine", () => {
  it("finds zero counterexamples for the generated base tenant policy", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: generatedPolicy(),
      boundary: boundary()
    });

    expect(report.verdict).toBe("PASS");
    expect(report.counterexamples).toHaveLength(0);
  });

  it("fails a policy allowing dynamodb:DeleteItem on the receipt table", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "BadReceiptDelete",
        Effect: "Allow",
        Action: "dynamodb:DeleteItem",
        Resource: receiptTableArn()
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples[0].requestState.action).toBe("dynamodb:DeleteItem");
  });

  it("fails a policy allowing dynamodb:Delete* on the receipt table", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "BadReceiptWildcardDelete",
        Effect: "Allow",
        Action: "dynamodb:Delete*",
        Resource: receiptTableArn()
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples.some((example) => example.requestState.action === "dynamodb:DeleteItem")).toBe(true);
  });

  it("fails a policy allowing s3:GetObject on another tenant prefix", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "BadCrossTenantRead",
        Effect: "Allow",
        Action: "s3:GetObject",
        Resource: "arn:aws:s3:::raw/tenants/tenant-b/raw/*"
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples.some((example) => example.requestState.resource.includes("/tenants/tenant-b/"))).toBe(true);
  });

  it("fails s3:DeleteObject on a tenant prefix unless the boundary explicitly allows it", () => {
    const document = policyWithStatement({
      Sid: "TenantDelete",
      Effect: "Allow",
      Action: "s3:DeleteObject",
      Resource: "arn:aws:s3:::raw/tenants/${aws:PrincipalTag/slug}/raw/*"
    });

    const denied = verifyNoTenantBoundaryCounterexample({
      document,
      boundary: boundary({ allowedS3ObjectActions: ["s3:GetObject", "s3:PutObject"] })
    });
    const allowed = verifyNoTenantBoundaryCounterexample({
      document,
      boundary: boundary({ allowedS3ObjectActions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"] })
    });

    expect(denied.verdict).toBe("FAIL");
    expect(allowed.verdict).toBe("PASS");
  });

  it("fails when a receipt table grant omits the dynamodb:LeadingKeys condition", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "MissingLeadingKeys",
        Effect: "Allow",
        Action: "dynamodb:GetItem",
        Resource: receiptTableArn()
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples.some((example) => example.requestState.conditionContext?.["dynamodb:LeadingKeys"] === undefined)).toBe(true);
  });

  it("fails when the dynamodb:LeadingKeys condition is for the wrong tenant", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "WrongLeadingKeys",
        Effect: "Allow",
        Action: "dynamodb:GetItem",
        Resource: receiptTableArn(),
        Condition: {
          "ForAllValues:StringEquals": {
            "dynamodb:LeadingKeys": ["tenant-b"]
          }
        }
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples.some((example) => example.requestState.conditionContext?.["dynamodb:LeadingKeys"])).toBe(true);
  });

  it("fails wildcard action allows", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "BadWildcard",
        Effect: "Allow",
        Action: "*",
        Resource: "*"
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.counterexamples.length).toBeGreaterThan(0);
  });

  it("fails closed on NotAction", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: {
        Version: "2012-10-17",
        Statement: [{ Sid: "BadNotAction", Effect: "Allow", NotAction: "s3:DeleteObject", Resource: "*" }]
      },
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("NotAction");
  });

  it("fails closed on NotResource", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: {
        Version: "2012-10-17",
        Statement: [{ Sid: "BadNotResource", Effect: "Allow", Action: "s3:GetObject", NotResource: rawTenantObjectArn() }]
      },
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("NotResource");
  });

  it("fails closed on unsupported condition operators", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "UnsupportedCondition",
        Effect: "Allow",
        Action: "s3:GetObject",
        Resource: rawTenantObjectArn(),
        Condition: {
          ArnLike: {
            "aws:PrincipalArn": "*"
          }
        }
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("Unsupported condition operator ArnLike");
  });

  it("fails closed on supported operators with unsupported condition keys", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "UnsupportedConditionKey",
        Effect: "Allow",
        Action: "s3:GetObject",
        Resource: rawTenantObjectArn(),
        Condition: {
          StringEquals: {
            "aws:PrincipalArn": `arn:aws:iam::${accountId}:role/out-of-model`
          }
        }
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("Unsupported condition key aws:PrincipalArn");
  });

  it("fails closed on resource-policy-only statement fields", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "ResourcePolicyShape",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: rawTenantObjectArn()
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("Unsupported statement field Principal");
  });

  it("fails closed on malformed Action and Resource values", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: policyWithStatement({
        Sid: "MalformedActionResource",
        Effect: "Allow",
        Action: ["s3:GetObject", 42],
        Resource: { Ref: "SomeBucket" }
      }),
      boundary: boundary()
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.warnings.join("\n")).toContain("Unsupported Action shape");
    expect(report.warnings.join("\n")).toContain("Unsupported Resource shape");
  });

  it("models principal tag substitution for the valid generated receipt-ledger case", () => {
    const request = {
      action: "dynamodb:PutItem",
      resource: receiptTableArn(),
      principalTags: { slug: tenantSlug },
      conditionContext: {
        "aws:RequestedRegion": "us-east-1",
        "aws:PrincipalTag/slug": tenantSlug,
        "dynamodb:LeadingKeys": [tenantSlug]
      }
    };

    expect(evaluateModeledPolicy({ document: generatedPolicy(), request })).toBe("Allow");
    expect(evaluateTenantBoundary({ boundary: boundary(), request })).toBe("Allow");
  });

  it("includes bounded-scope non-claims in reports", () => {
    const report = verifyNoTenantBoundaryCounterexample({
      document: generatedPolicy(),
      boundary: boundary()
    });

    expect(report.nonClaims).toContain("not full AWS IAM verification");
    expect(report.nonClaims).toContain("bounded to Ghost-Ark generated tenant sandbox subset");
  });

  it("changes the policy digest when the policy changes", () => {
    const first = verifyNoTenantBoundaryCounterexample({ document: generatedPolicy(), boundary: boundary() });
    const second = verifyNoTenantBoundaryCounterexample({
      document: {
        ...generatedPolicy(),
        Statement: [...generatedPolicy().Statement, { Sid: "Extra", Effect: "Allow", Action: "s3:GetObject", Resource: rawTenantObjectArn() }]
      },
      boundary: boundary()
    });

    expect(first.policyDigest).not.toBe(second.policyDigest);
  });

  it("changes the boundary digest when the boundary changes", () => {
    const first = verifyNoTenantBoundaryCounterexample({ document: generatedPolicy(), boundary: boundary() });
    const second = verifyNoTenantBoundaryCounterexample({
      document: generatedPolicy(),
      boundary: boundary({ allowedReceiptLedgerActions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"] })
    });

    expect(first.boundaryDigest).not.toBe(second.boundaryDigest);
  });
});
