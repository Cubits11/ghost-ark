import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "../../../infra/cdk/lib/api-stack";

type LambdaEnvironmentVariables = Record<string, string>;

type CfnResource = {
  Type: string;
  Properties?: {
    Environment?: {
      Variables?: LambdaEnvironmentVariables;
    };
  };
};

type CfnTemplate = {
  Resources: Record<string, CfnResource>;
};

const cdkSynthTimeoutMs = 60_000;
const expectedApiLambdaCount = 5;

const templateCache = new Map<string, CfnTemplate>();

function synthApiTemplate(stage: string): CfnTemplate {
  const cached = templateCache.get(stage);
  if (cached) {
    return cached;
  }

  const app = new App({
    context: {
      stage,
      project: "ghost-ark"
    }
  });

  const stack = new ApiStack(app, `GhostArk${stage}Api`, {
    stage,
    project: "ghost-ark"
  });

  const template = Template.fromStack(stack).toJSON() as CfnTemplate;
  templateCache.set(stage, template);
  return template;
}

function lambdaEnvironmentVariables(template: CfnTemplate): LambdaEnvironmentVariables[] {
  const lambdaResources = Object.values(template.Resources).filter(
    (resource) => resource.Type === "AWS::Lambda::Function"
  );

  const environments = lambdaResources.map((resource) => resource.Properties?.Environment?.Variables ?? {});

  const apiHandlerEnvironments = environments.filter((variables) =>
    Object.prototype.hasOwnProperty.call(variables, "ALLOW_DEVELOPER_HEADERS")
  );

  if (apiHandlerEnvironments.length !== expectedApiLambdaCount) {
    throw new Error(
      `Expected ${expectedApiLambdaCount} API Lambda environments with ALLOW_DEVELOPER_HEADERS, found ${apiHandlerEnvironments.length}. Total Lambda resources: ${lambdaResources.length}.`
    );
  }

  return apiHandlerEnvironments;
}

function expectDeveloperHeadersDisabled(environments: LambdaEnvironmentVariables[]): void {
  for (const variables of environments) {
    expect(variables.ALLOW_DEVELOPER_HEADERS).toBe("false");
  }
}

function expectCoreApiEnvironment(stage: string, variables: LambdaEnvironmentVariables): void {
  expect(variables.STAGE).toBe(stage);
  expect(variables.RECEIPT_LEDGER_TABLE).toBeDefined();
  expect(variables.CLAIM_LEDGER_TABLE).toBeDefined();
  expect(variables.LINEAGE_LEDGER_TABLE).toBeDefined();
  expect(variables.KMS_SIGNING_KEY_ID).toBeDefined();

  expect(variables.GHOST_ARK_MODEL_MODE).toBe("bedrock");
  expect(variables.GHOST_ARK_RECEIPT_SIGNER).toBe("kms");
  expect(variables.GHOST_ARK_POLICY_REPOSITORY).toBe("dynamodb");
  expect(variables.GHOST_ARK_VAULT).toBe("dynamodb");
  expect(variables.GHOST_ARK_DECISION_RECEIPT_REPOSITORY).toBe("dynamodb");

  expect(variables.GHOST_ARK_RECEIPT_CHECKPOINT_TABLE).toBeDefined();
  expect(variables.GHOST_ARK_CHECKPOINT_SIGNING_KEY_ID).toBeDefined();
  expect(variables.GHOST_ARK_CHECKPOINT_PUBLISH_BUCKET).toBeDefined();
  expect(variables.GHOST_ARK_CHECKPOINT_PUBLISH_PREFIX).toBe("receipt-checkpoints");

  expect(variables.OPENSEARCH_ENDPOINT).toBe("");
  expect(variables.OPENSEARCH_INDEX_PREFIX).toBe(`ghost-ark-${stage}`);
}

describe("API Lambda environment security settings", () => {
  let prodEnvironments: LambdaEnvironmentVariables[];
  let devEnvironments: LambdaEnvironmentVariables[];

  beforeAll(() => {
    prodEnvironments = lambdaEnvironmentVariables(synthApiTemplate("prod"));
    devEnvironments = lambdaEnvironmentVariables(synthApiTemplate("dev"));
  }, cdkSynthTimeoutMs);

  it("disables developer headers in prod", () => {
    expect(prodEnvironments).toHaveLength(expectedApiLambdaCount);
    expectDeveloperHeadersDisabled(prodEnvironments);
  });

  it("disables developer headers outside prod as well", () => {
    expect(devEnvironments).toHaveLength(expectedApiLambdaCount);
    expectDeveloperHeadersDisabled(devEnvironments);
  });

  it("keeps core API handlers wired to receipt, claim, lineage, KMS, and search-disabled environment variables", () => {
    expect(devEnvironments).toHaveLength(expectedApiLambdaCount);

    for (const variables of devEnvironments) {
      expectCoreApiEnvironment("dev", variables);
    }
  });
});