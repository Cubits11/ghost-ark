import { CfnWorkGroup } from "aws-cdk-lib/aws-athena";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface AthenaWorkgroupProps {
  stage: string;
  resultsBucket: IBucket;
}

export class AthenaWorkgroup extends Construct {
  readonly workgroup: CfnWorkGroup;

  constructor(scope: Construct, id: string, props: AthenaWorkgroupProps) {
    super(scope, id);
    this.workgroup = new CfnWorkGroup(this, "EvidenceWorkgroup", {
      name: `ghost-ark-${props.stage}`,
      state: "ENABLED",
      recursiveDeleteOption: props.stage !== "prod",
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${props.resultsBucket.bucketName}/shared/`
        }
      }
    });
  }
}
