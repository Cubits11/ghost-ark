import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ApiStack } from "../../../infra/cdk/lib/api-stack";

type CfnResource = {
  Type: string;
  Properties?: Record<string, unknown>;
};

type CfnTemplate = {
  Resources: Record<string, CfnResource>;
};

function synthApiTemplate(): CfnTemplate {
  const app = new App();
  const stack = new ApiStack(app, "GhostArkTestApi", {
    stage: "test",
    project: "ghost-ark"
  });
  return Template.fromStack(stack).toJSON() as CfnTemplate;
}

function refValue(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "Ref" in value) {
    const ref = (value as { Ref?: unknown }).Ref;
    return typeof ref === "string" ? ref : undefined;
  }
  return undefined;
}

function buildResourcePaths(template: CfnTemplate): Record<string, string> {
  const paths: Record<string, string> = {};

  function pathFor(logicalId: string): string {
    if (paths[logicalId]) {
      return paths[logicalId];
    }

    const resource = template.Resources[logicalId];
    if (!resource || resource.Type !== "AWS::ApiGateway::Resource") {
      throw new Error(`Unknown API Gateway resource logical id: ${logicalId}`);
    }

    const pathPart = resource.Properties?.PathPart;
    if (typeof pathPart !== "string") {
      throw new Error(`API Gateway resource ${logicalId} is missing PathPart`);
    }

    const parentRef = refValue(resource.Properties?.ParentId);
    if (!parentRef) {
      throw new Error(`API Gateway resource ${logicalId} is missing ParentId Ref`);
    }

    const parent =
      template.Resources[parentRef]?.Type === "AWS::ApiGateway::Resource"
        ? pathFor(parentRef)
        : "";

    const fullPath = `${parent}/${pathPart}`.replaceAll("//", "/");
    paths[logicalId] = fullPath;
    return fullPath;
  }

  for (const [logicalId, resource] of Object.entries(template.Resources)) {
    if (resource.Type === "AWS::ApiGateway::Resource") {
      pathFor(logicalId);
    }
  }

  return paths;
}

function methodMatrix(template: CfnTemplate): Record<string, Record<string, unknown>> {
  const resourcePaths = buildResourcePaths(template);
  const matrix: Record<string, Record<string, unknown>> = {};

  for (const resource of Object.values(template.Resources)) {
    if (resource.Type !== "AWS::ApiGateway::Method") {
      continue;
    }

    const httpMethod = resource.Properties?.HttpMethod;
    if (typeof httpMethod !== "string") {
      continue;
    }

    const resourceRef = refValue(resource.Properties?.ResourceId);
    const path = resourceRef ? resourcePaths[resourceRef] : "/";
    matrix[`${httpMethod} ${path}`] = resource.Properties ?? {};
  }

  return matrix;
}

describe("API Gateway authorization template", () => {
  it("protects core receipt and claim routes with Cognito authorization", () => {
    const template = synthApiTemplate();
    const methods = methodMatrix(template);

    const protectedRoutes = [
      "POST /receipts",
      "GET /tenants/{tenantSlug}/receipts/{receiptId}",
      "GET /tenants/{tenantSlug}/claims"
    ];

    for (const route of protectedRoutes) {
      expect(methods[route], `missing API method for ${route}`).toBeDefined();
      expect(methods[route].AuthorizationType, `${route} must use Cognito authorization`).toBe("COGNITO");
      expect(methods[route].AuthorizerId, `${route} must reference an authorizer`).toBeDefined();
    }
  });

  it("does not synthesize the search route when search is disabled", () => {
    const template = synthApiTemplate();
    const methods = methodMatrix(template);

    expect(methods["GET /tenants/{tenantSlug}/search"]).toBeUndefined();
  });
});
