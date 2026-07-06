import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface DynamoDbLedgerProps {
  stage: string;
}

export class DynamoDbLedger extends Construct {
  readonly receipts: Table;
  readonly claims: Table;
  readonly lineage: Table;

  constructor(scope: Construct, id: string, props: DynamoDbLedgerProps) {
    super(scope, id);
    const removalPolicy = props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.receipts = new Table(this, "ReceiptsTable", {
      tableName: `ghost-ark-${props.stage}-receipts`,
      partitionKey: { name: "tenantSlug", type: AttributeType.STRING },
      sortKey: { name: "receiptId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    this.claims = new Table(this, "ClaimsTable", {
      tableName: `ghost-ark-${props.stage}-claims`,
      partitionKey: { name: "tenantSlug", type: AttributeType.STRING },
      sortKey: { name: "claimId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    this.lineage = new Table(this, "LineageTable", {
      tableName: `ghost-ark-${props.stage}-lineage`,
      partitionKey: { name: "tenantSlug", type: AttributeType.STRING },
      sortKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
  }
}
