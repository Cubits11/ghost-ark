#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { OrchestrationStack } from "../lib/orchestration-stack";
import { SearchStack } from "../lib/search-stack";
import { ObservatoryStack } from "../lib/observatory-stack";

const app = new App();
const stage = app.node.tryGetContext("stage") ?? process.env.STAGE ?? "dev";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1"
};

const search = new SearchStack(app, `GhostArk-${stage}-Search`, { stage, env });
new ApiStack(app, `GhostArk-${stage}-Api`, { stage, env, opensearchEndpoint: search.domainEndpoint });
new OrchestrationStack(app, `GhostArk-${stage}-Orchestration`, { stage, env });
new ObservatoryStack(app, `GhostArk-${stage}-Observatory`, { stage, env });
