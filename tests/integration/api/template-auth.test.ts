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

function resourcesOfType(template: CfnTemplate, type: string): CfnResource[] {
  return Object.values(template.Resources).filter((resource) => resource.Type === type);
}

describe("API Gateway authorization template", () => {
  it("protects every synthesized API method with Cognito user-pool authorization", () => {
    const template = synthApiTemplate();
    const methods = resourcesOfType(template, "AWS::ApiGateway::Method");

    expect(methods.length).toBe(3);

    const httpMethods = methods
      .map((method) => method.Properties?.HttpMethod)
      .sort();

    expect(httpMethods).toEqual(["GET", "GET", "POST"]);

    for (const method of methods) {
      expect(method.Properties?.AuthorizationType).toBe("COGNITO_USER_POOLS");
      expect(method.Properties?.AuthorizerId).toBeDefined();
    }
  });

  it("synthesizes the expected core route resources without search when search is disabled", () => {
    const template = synthApiTemplate();
    const resources = resourcesOfType(template, "AWS::ApiGateway::Resource");

    const pathParts = resources
      .map((resource) => resource.Properties?.PathPart)
      .sort();

    expect(pathParts).toEqual([
      "claims",
      "receipts",
      "receipts",
      "tenants",
      "{receiptId}",
      "{tenantSlug}"
    ]);

    expect(pathParts).not.toContain("search");
  });
});
