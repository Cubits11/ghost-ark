import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, Metric, TextWidget } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface ObservatoryStackProps extends StackProps {
  stage: string;
}

export class ObservatoryStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservatoryStackProps) {
    super(scope, id, props);
    const topic = new Topic(this, "ObservatoryAlerts", {
      topicName: `ghost-ark-${props.stage}-observatory-alerts`
    });
    const lambdaErrors = new Metric({
      namespace: "AWS/Lambda",
      metricName: "Errors",
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const alarmAction = new SnsAction(topic);
    const lambdaErrorAlarm = new Alarm(this, "LambdaErrorAlarm", {
      metric: lambdaErrors,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    lambdaErrorAlarm.addAlarmAction(alarmAction);
    const receiptGapMetric = new Metric({
      namespace: "GhostArk",
      metricName: "ReceiptGapCount",
      dimensionsMap: { Stage: props.stage },
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const receiptGapAlarm = new Alarm(this, "ReceiptGapAlarm", {
      metric: receiptGapMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    receiptGapAlarm.addAlarmAction(alarmAction);
    new Dashboard(this, "ObservatoryDashboard", {
      dashboardName: `ghost-ark-${props.stage}-observatory`,
      widgets: [
        [new TextWidget({ markdown: `# Ghost Ark ${props.stage} Observatory`, width: 24, height: 2 })],
        [new GraphWidget({ title: "Lambda errors", left: [lambdaErrors], width: 12 })],
        [new GraphWidget({ title: "Receipt gaps", left: [receiptGapMetric], width: 12 })],
        [
          new GraphWidget({
            title: "Receipt table consumed capacity",
            left: [
              new Metric({
                namespace: "AWS/DynamoDB",
                metricName: "ConsumedReadCapacityUnits",
                dimensionsMap: { TableName: `ghost-ark-${props.stage}-receipts` },
                statistic: "sum"
              })
            ],
            width: 12
          })
        ]
      ]
    });
  }
}
