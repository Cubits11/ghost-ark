import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { OrchestrationStack } from "../lib/orchestration-stack";

describe("OrchestrationStack Step Functions IAM", () => {
  it("does not synthesize global wildcard Step Functions role resources in dev", () => {
    const app = new App();
    const stack = new OrchestrationStack(app, "GhostArkDevOrchestrationTest", { stage: "dev" });
    const template = Template.fromStack(stack).toJSON();
    const policies = Object.values(template.Resources as Record<string, { Type: string; Properties?: Record<string, unknown> }>).filter(
      (resource) => resource.Type === "AWS::IAM::Policy"
    );

    expect(JSON.stringify(policies)).not.toContain('"Resource":"*"');
  });

  it("fails production synthesis when Step Functions resources would require wildcard scope", () => {
    const app = new App();

    expect(
      () =>
        new OrchestrationStack(app, "GhostArkProdOrchestrationTest", {
          stage: "prod",
          allowedLambdaFunctionArns: ["arn:aws:lambda:us-east-1:111122223333:function:ghost-ark-prod-receipt-issuer"]
        })
    ).toThrow(/Production Step Functions IAM/u);
  });

  it("allows production synthesis with concrete scoped resources", () => {
    const app = new App();
    const stack = new OrchestrationStack(app, "GhostArkProdScopedOrchestrationTest", {
      stage: "prod",
      allowedGlueCrawlerArns: ["arn:aws:glue:us-east-1:111122223333:crawler/ghost-ark-prod-acme-lab"],
      allowedAthenaWorkgroupArns: ["arn:aws:athena:us-east-1:111122223333:workgroup/ghost-ark-prod-acme-lab"],
      allowedLambdaFunctionArns: ["arn:aws:lambda:us-east-1:111122223333:function:ghost-ark-prod-receipt-issuer"]
    });

    expect(() => Template.fromStack(stack)).not.toThrow();
  });
});
