import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, Metric, TextWidget, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface ObservatoryStackProps extends StackProps {
  stage: string;
}

/**
 * Observatory alarms.
 *
 * Invariant (E4, "alert masking"): a security-relevant alarm must FAIL LOUD.
 * Its firing may not depend on the monitored component continuing to emit
 * telemetry, because "the metric went silent" is indistinguishable from "the
 * emitter was suppressed". Two consequences enforced here:
 *
 *   1. The receipt-gap alarm (a tamper signal) treats MISSING data as BREACHING,
 *      so silencing the gap emitter raises the alarm instead of clearing it.
 *   2. A liveness alarm fires when the receipt pipeline stops producing
 *      receipts at all — absence of signal is itself alarmed. Without it, an
 *      attacker who halts the whole pipeline produces neither gaps nor errors
 *      (total silence) and no alarm ever fires.
 *
 * Error alarms are positive signals, so missing error data is intentionally
 * NOT_BREACHING (no invocations should not page an operator).
 */
export class ObservatoryStack extends Stack {
  constructor(scope: Construct, id: string, props: ObservatoryStackProps) {
    super(scope, id, props);
    const topic = new Topic(this, "ObservatoryAlerts", {
      topicName: `ghost-ark-${props.stage}-observatory-alerts`
    });
    const alarmAction = new SnsAction(topic);

    const lambdaErrors = new Metric({
      namespace: "AWS/Lambda",
      metricName: "Errors",
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const lambdaErrorAlarm = new Alarm(this, "LambdaErrorAlarm", {
      metric: lambdaErrors,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Positive signal: no error datapoints means no failures, not an incident.
      treatMissingData: TreatMissingData.NOT_BREACHING
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
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Tamper signal: a suppressed emitter (missing data) must raise, not clear.
      treatMissingData: TreatMissingData.BREACHING
    });
    receiptGapAlarm.addAlarmAction(alarmAction);
    receiptGapAlarm.addInsufficientDataAction(alarmAction);

    // Liveness: alarm when the receipt pipeline stops producing receipts.
    const receiptHeartbeatMetric = new Metric({
      namespace: "GhostArk",
      metricName: "ReceiptsEmitted",
      dimensionsMap: { Stage: props.stage },
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const receiptPipelineSilentAlarm = new Alarm(this, "ReceiptPipelineSilentAlarm", {
      alarmName: `ghost-ark-${props.stage}-receipt-pipeline-silent`,
      metric: receiptHeartbeatMetric,
      threshold: 1,
      // 15 minutes of zero-or-missing receipt production raises the alarm.
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      // Absence of signal is the incident: missing data BREACHES.
      treatMissingData: TreatMissingData.BREACHING
    });
    receiptPipelineSilentAlarm.addAlarmAction(alarmAction);
    receiptPipelineSilentAlarm.addInsufficientDataAction(alarmAction);

    new Dashboard(this, "ObservatoryDashboard", {
      dashboardName: `ghost-ark-${props.stage}-observatory`,
      widgets: [
        [new TextWidget({ markdown: `# Ghost Ark ${props.stage} Observatory`, width: 24, height: 2 })],
        [new GraphWidget({ title: "Lambda errors", left: [lambdaErrors], width: 12 })],
        [new GraphWidget({ title: "Receipt gaps", left: [receiptGapMetric], width: 12 })],
        [new GraphWidget({ title: "Receipts emitted (liveness)", left: [receiptHeartbeatMetric], width: 12 })],
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
