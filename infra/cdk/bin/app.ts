#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { OrchestrationStack } from "../lib/orchestration-stack";
import { SearchStack } from "../lib/search-stack";
import { ObservatoryStack } from "../lib/observatory-stack";

const app = new App();
const stage = app.node.tryGetContext("stage") ?? process.env.STAGE ?? "dev";
const project = app.node.tryGetContext("project") ?? process.env.PROJECT ?? "ghost-ark";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1"
};

const search = new SearchStack(app, `GhostArk-${stage}-Search`, { stage, env });
new ApiStack(app, `GhostArk-${stage}-Api`, {
  stage,
  project,
  env,
  opensearchEndpoint: search.domainEndpoint,
  searchSecurityGroup: search.apiSearchSecurityGroup,
  searchVpc: search.vpc
});
new OrchestrationStack(app, `GhostArk-${stage}-Orchestration`, { stage, env });
new ObservatoryStack(app, `GhostArk-${stage}-Observatory`, { stage, env });
