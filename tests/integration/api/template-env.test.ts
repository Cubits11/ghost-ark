import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ApiStack } from "../../../infra/cdk/lib/api-stack";

type CfnResource = {
  Type: string;
  Properties?: {
    Environment?: {
      Variables?: Record<string, string>;
    };
  };
};

type CfnTemplate = {
  Resources: Record<string, CfnResource>;
};

function synthApiTemplate(stage: string): CfnTemplate {
  const app = new App();
  const stack = new ApiStack(app, `GhostArk${stage}Api`, {
    stage,
    project: "ghost-ark"
  });

  return Template.fromStack(stack).toJSON() as CfnTemplate;
}

function lambdaEnvironmentVariables(template: CfnTemplate): Record<string, string>[] {
  return Object.values(template.Resources)
    .filter((resource) => resource.Type === "AWS::Lambda::Function")
    .map((resource) => resource.Properties?.Environment?.Variables)
    .filter((variables): variables is Record<string, string> => Boolean(variables?.ALLOW_DEVELOPER_HEADERS));
}

describe("API Lambda environment security settings", () => {
  it("disables developer headers in prod", () => {
    const template = synthApiTemplate("prod");
    const environments = lambdaEnvironmentVariables(template);

    expect(environments.length).toBe(3);

    for (const variables of environments) {
      expect(variables.ALLOW_DEVELOPER_HEADERS).toBe("false");
    }
  });

  it("allows developer headers outside prod for controlled development flows", () => {
    const template = synthApiTemplate("dev");
    const environments = lambdaEnvironmentVariables(template);

    expect(environments.length).toBe(3);

    for (const variables of environments) {
      expect(variables.ALLOW_DEVELOPER_HEADERS).toBe("true");
    }
  });

  it("keeps core API handlers wired to receipt, claim, lineage, KMS, and search-disabled environment variables", () => {
    const template = synthApiTemplate("dev");
    const environments = lambdaEnvironmentVariables(template);

    expect(environments.length).toBe(3);

    for (const variables of environments) {
      expect(variables.STAGE).toBe("dev");
      expect(variables.RECEIPT_LEDGER_TABLE).toBeDefined();
      expect(variables.CLAIM_LEDGER_TABLE).toBeDefined();
      expect(variables.LINEAGE_LEDGER_TABLE).toBeDefined();
      expect(variables.KMS_SIGNING_KEY_ID).toBeDefined();
      expect(variables.OPENSEARCH_ENDPOINT).toBe("");
      expect(variables.OPENSEARCH_INDEX_PREFIX).toBe("ghost-ark-dev");
    }
  });
});
