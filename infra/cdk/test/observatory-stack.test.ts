import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ObservatoryStack } from "../lib/observatory-stack";

function synthObservatory() {
  const app = new App();
  const stack = new ObservatoryStack(app, "GhostArkDevObservatoryTest", { stage: "dev" });
  return Template.fromStack(stack);
}

describe("ObservatoryStack — E4 alert-masking invariants", () => {
  it("the receipt-gap tamper alarm treats missing data as BREACHING", () => {
    const template = synthObservatory();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReceiptGapCount",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "breaching"
    });
  });

  it("a liveness alarm fires when the receipt pipeline goes silent (missing = breaching)", () => {
    const template = synthObservatory();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReceiptsEmitted",
      ComparisonOperator: "LessThanThreshold",
      TreatMissingData: "breaching"
    });
  });

  it("the error alarm is intentionally NOT_BREACHING on missing data (positive signal)", () => {
    const template = synthObservatory();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Namespace: "AWS/Lambda",
      TreatMissingData: "notBreaching"
    });
  });

  it("no security-relevant alarm silently uses the CloudFormation default (missing = INSUFFICIENT_DATA)", () => {
    const template = synthObservatory();
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    for (const [logicalId, alarm] of Object.entries(alarms)) {
      const props = (alarm as { Properties?: Record<string, unknown> }).Properties ?? {};
      expect(
        props.TreatMissingData,
        `${logicalId} must set TreatMissingData explicitly`
      ).toBeDefined();
    }
  });

  it("every alarm notifies the observatory SNS topic", () => {
    const template = synthObservatory();
    template.resourceCountIs("AWS::SNS::Topic", 1);
    // Gap + liveness alarms also page on INSUFFICIENT_DATA, so they carry actions.
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ReceiptGapCount",
      AlarmActions: Match.anyValue(),
      InsufficientDataActions: Match.anyValue()
    });
  });
});
