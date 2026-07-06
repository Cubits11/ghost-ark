import fs from "fs";
import path from "path";
import { Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";

export interface OrchestrationStackProps extends StackProps {
  stage: string;
}

function readDefinition(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), "services/orchestration/stepfunctions", fileName), "utf8");
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
    role.addToPolicy(
      new PolicyStatement({
        actions: [
          "glue:StartCrawler",
          "glue:GetCrawler",
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "lambda:InvokeFunction",
          "sns:Publish"
        ],
        resources: ["*"]
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
