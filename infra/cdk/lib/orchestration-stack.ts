import fs from "fs";
import path from "path";
import { ArnFormat, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export interface OrchestrationStackProps extends StackProps {
  stage: string;
  allowedGlueCrawlerArns?: string[];
  allowedAthenaWorkgroupArns?: string[];
  allowedLambdaFunctionArns?: string[];
}

function readDefinition(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), "services/orchestration/stepfunctions", fileName), "utf8");
}

function assertNoProductionWildcards(stage: string, label: string, resources: string[]): void {
  if (stage !== "prod") {
    return;
  }
  if (resources.length === 0) {
    throw new Error(`Production Step Functions IAM requires at least one scoped ${label} ARN`);
  }
  const wildcard = resources.find((resource) => resource.includes("*"));
  if (wildcard) {
    throw new Error(`Production Step Functions IAM forbids wildcard ${label} resources: ${wildcard}`);
  }
}

function resourceSet(stage: string, label: string, provided: string[] | undefined, fallback: string[]): string[] {
  const resources = provided && provided.length > 0 ? provided : fallback;
  assertNoProductionWildcards(stage, label, resources);
  return resources;
}

export class OrchestrationStack extends Stack {
  readonly notificationTopic: Topic;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
    super(scope, id, props);
    this.notificationTopic = new Topic(this, "PipelineNotifications", {
      topicName: `ghost-ark-${props.stage}-pipeline-notifications`
    });
    const role = new Role(this, "StepFunctionsRole", {
      assumedBy: new ServicePrincipal("states.amazonaws.com")
    });
    const glueCrawlerArns = resourceSet(
      props.stage,
      "Glue crawler",
      props.allowedGlueCrawlerArns,
      [
        this.formatArn({
          service: "glue",
          resource: "crawler",
          resourceName: `ghost-ark-${props.stage}-*`,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME
        })
      ]
    );
    const athenaWorkgroupArns = resourceSet(
      props.stage,
      "Athena workgroup",
      props.allowedAthenaWorkgroupArns,
      [
        this.formatArn({
          service: "athena",
          resource: "workgroup",
          resourceName: `ghost-ark-${props.stage}-*`,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME
        })
      ]
    );
    const lambdaFunctionArns = resourceSet(
      props.stage,
      "Lambda function",
      props.allowedLambdaFunctionArns,
      [
        this.formatArn({
          service: "lambda",
          resource: "function",
          resourceName: `ghost-ark-${props.stage}-*`,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME
        })
      ]
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["glue:StartCrawler", "glue:GetCrawler"],
        resources: glueCrawlerArns
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"],
        resources: athenaWorkgroupArns
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: lambdaFunctionArns
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [this.notificationTopic.topicArn]
      })
    );
    new CfnStateMachine(this, "ReceiptPipeline", {
      stateMachineName: `ghost-ark-${props.stage}-receipt-pipeline`,
      roleArn: role.roleArn,
      definitionString: readDefinition("receipt_pipeline.asl.json")
    });
    new CfnStateMachine(this, "ReplayPipeline", {
      stateMachineName: `ghost-ark-${props.stage}-replay-pipeline`,
      roleArn: role.roleArn,
      definitionString: readDefinition("replay_pipeline.asl.json")
    });
  }
}
