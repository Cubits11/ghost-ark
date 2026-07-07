#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack, ApiStackProps } from "../lib/api-stack";
import { OrchestrationStack } from "../lib/orchestration-stack";
import { SearchStack } from "../lib/search-stack";
import { ObservatoryStack } from "../lib/observatory-stack";

const app = new App();
const stage = app.node.tryGetContext("stage") ?? process.env.STAGE ?? "dev";
const project = app.node.tryGetContext("project") ?? process.env.PROJECT ?? "ghost-ark";
const enableSearch =
  app.node.tryGetContext("enableSearch") === true ||
  app.node.tryGetContext("enableSearch") === "true" ||
  process.env.GHOST_ARK_ENABLE_SEARCH === "true";
const bedrockModelAllowlistContext = app.node.tryGetContext("bedrockModelAllowlist") ?? process.env.GHOST_ARK_BEDROCK_MODEL_ALLOWLIST ?? "";
const bedrockModelAllowlist = Array.isArray(bedrockModelAllowlistContext)
  ? bedrockModelAllowlistContext
  : String(bedrockModelAllowlistContext)
      .split(",")
      .map((modelId) => modelId.trim())
      .filter(Boolean);
const allowWildcardBedrockModels =
  app.node.tryGetContext("allowWildcardBedrockModels") === true ||
  app.node.tryGetContext("allowWildcardBedrockModels") === "true" ||
  process.env.GHOST_ARK_ALLOW_WILDCARD_BEDROCK_MODELS === "true";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1"
};

const apiProps: ApiStackProps = {
  stage,
  project,
  env,
  bedrockModelAllowlist,
  allowWildcardBedrockModels
};

if (enableSearch) {
  const search = new SearchStack(app, `GhostArk-${stage}-Search`, { stage, env });
  apiProps.opensearchEndpoint = search.domainEndpoint;
  apiProps.opensearchDomainArn = search.domainArn;
  apiProps.searchSecurityGroup = search.apiSearchSecurityGroup;
  apiProps.searchVpc = search.vpc;
}

new ApiStack(app, `GhostArk-${stage}-Api`, apiProps);
new OrchestrationStack(app, `GhostArk-${stage}-Orchestration`, { stage, env });
new ObservatoryStack(app, `GhostArk-${stage}-Observatory`, { stage, env });
