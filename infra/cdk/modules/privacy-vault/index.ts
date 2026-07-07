import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface PrivacyVaultProps {
  stage: string;
}

export class PrivacyVault extends Construct {
  readonly table: Table;

  constructor(scope: Construct, id: string, props: PrivacyVaultProps) {
    super(scope, id);
    this.table = new Table(this, "PrivacyVaultTable", {
      tableName: `ghost-ark-${props.stage}-privacy-vault`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAtEpoch",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });
  }
}
