import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ApiStack } from "../lib/api-stack";

function synthApiTemplate(options: { allowlist?: string[]; wildcard?: boolean } = {}) {
  const app = new App();
  const stack = new ApiStack(app, "GhostArkDevApiTest", {
    stage: "dev",
    project: "ghost-ark",
    bedrockModelAllowlist: options.allowlist,
    allowWildcardBedrockModels: options.wildcard
  });
  return Template.fromStack(stack);
}

describe("ApiStack governed invoke AWS reality gate", () => {
  it("wires the invoke route behind a Cognito authorizer", () => {
    const template = synthApiTemplate();

    template.resourceCountIs("AWS::ApiGateway::Authorizer", 1);
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "POST",
      AuthorizationType: "COGNITO_USER_POOLS"
    });
  });

  it("creates policy, privacy vault, decision receipt tables, and an HMAC digest secret", () => {
    const template = synthApiTemplate();

    template.hasResourceProperties("AWS::DynamoDB::Table", { TableName: "ghost-ark-dev-tenant-policies" });
    template.hasResourceProperties("AWS::DynamoDB::Table", { TableName: "ghost-ark-dev-privacy-vault" });
    template.hasResourceProperties("AWS::DynamoDB::Table", { TableName: "ghost-ark-dev-decision-receipts" });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "ghost-ark-dev-decision-receipt-hmac-secret"
    });
  });

  it("creates an asymmetric KMS signing key for receipt signatures", () => {
    const template = synthApiTemplate();

    template.hasResourceProperties("AWS::KMS::Key", {
      KeySpec: "RSA_2048",
      KeyUsage: "SIGN_VERIFY"
    });
    template.hasResourceProperties("AWS::KMS::Alias", {
      AliasName: "alias/ghost-ark-dev-receipt-signing"
    });
  });

  it("does not put a plaintext HMAC secret into Lambda environment variables", () => {
    const template = synthApiTemplate();
    const json = template.toJSON();
    const lambdaFunctions = Object.values(json.Resources as Record<string, { Type: string; Properties?: Record<string, unknown> }>).filter(
      (resource) => resource.Type === "AWS::Lambda::Function"
    );

    expect(JSON.stringify(lambdaFunctions)).not.toContain("GHOST_ARK_RECEIPT_HMAC_SECRET\":\"");
    expect(JSON.stringify(lambdaFunctions)).toContain("GHOST_ARK_RECEIPT_HMAC_SECRET_ARN");
  });

  it("scopes Bedrock invoke IAM to foundation-model ARNs when a model allowlist is provided", () => {
    const template = synthApiTemplate({ allowlist: ["anthropic.claude-3-5-sonnet-20240620-v1:0"] });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["bedrock:InvokeModel"]),
            Resource: {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  { Ref: "AWS::Partition" },
                  ":bedrock:",
                  { Ref: "AWS::Region" },
                  "::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"
                ]
              ]
            }
          })
        ])
      }
    });
  });

  it("does not grant wildcard Bedrock invoke unless explicitly opted in", () => {
    const defaultTemplate = synthApiTemplate().toJSON();
    expect(JSON.stringify(defaultTemplate)).not.toContain("bedrock:InvokeModel");

    const wildcardTemplate = synthApiTemplate({ wildcard: true });
    wildcardTemplate.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["bedrock:InvokeModel"]),
            Resource: "*"
          })
        ])
      }
    });
  });

  it("adds governed invoke operational alarms", () => {
    const template = synthApiTemplate();

    for (const metricName of [
      "GovernedInvokeFailedClosed",
      "GovernedInvokeReceiptEmissionFailed",
      "GovernedInvokeKmsSigningFailed",
      "GovernedInvokeBedrockFailed"
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metricName,
        Namespace: "GhostArk/GovernedInvoke"
      });
    }
  });
});
