import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "../../../infra/cdk/lib/api-stack";

type CfnResource = {
  Type: string;
  Properties?: Record<string, unknown>;
};

type CfnTemplate = {
  Resources: Record<string, CfnResource>;
};

/**
 * Memoized for the same reason as infra/cdk/test/api-stack-governed-invoke.test.ts:
 * a cold aws-cdk-lib/jsii load plus one synth per `it` exceeded the 15s global
 * vitest timeout under parallel load, making `npm test` nondeterministically red
 * on a clean clone. The pre-warm below pays the cold cost under a hook timeout.
 */
let cachedTemplate: CfnTemplate | undefined;

function synthApiTemplate(): CfnTemplate {
  if (cachedTemplate) {
    return cachedTemplate;
  }

  const app = new App();
  const stack = new ApiStack(app, "GhostArkTestApi", {
    stage: "test",
    project: "ghost-ark"
  });

  cachedTemplate = Template.fromStack(stack).toJSON() as CfnTemplate;
  return cachedTemplate;
}

function resourcesOfType(template: CfnTemplate, type: string): CfnResource[] {
  return Object.values(template.Resources).filter((resource) => resource.Type === type);
}

describe("API Gateway authorization template", () => {
  beforeAll(() => {
    synthApiTemplate();
  }, 180_000);

  it("protects every synthesized API method with Cognito user-pool authorization", () => {
    const template = synthApiTemplate();
    const methods = resourcesOfType(template, "AWS::ApiGateway::Method");

    expect(methods.length).toBe(4);

    const httpMethods = methods
      .map((method) => method.Properties?.HttpMethod)
      .sort();

    expect(httpMethods).toEqual(["GET", "GET", "POST", "POST"]);

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
      "invoke",
      "receipts",
      "receipts",
      "tenants",
      "{receiptId}",
      "{tenantSlug}"
    ]);

    expect(pathParts).not.toContain("search");
  });
});
