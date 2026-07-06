import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Alias, Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export interface KmsSigningProps {
  stage: string;
}

export class KmsSigning extends Construct {
  readonly key: Key;
  readonly alias: Alias;

  constructor(scope: Construct, id: string, props: KmsSigningProps) {
    super(scope, id);
    this.key = new Key(this, "ReceiptSigningKey", {
      description: `Ghost Ark ${props.stage} asymmetric receipt signing key`,
      keySpec: KeySpec.RSA_3072,
      keyUsage: KeyUsage.SIGN_VERIFY,
      pendingWindow: Duration.days(30),
      removalPolicy: RemovalPolicy.RETAIN
    });
    this.alias = new Alias(this, "ReceiptSigningAlias", {
      aliasName: `alias/ghost-ark-${props.stage}-receipt-signing`,
      targetKey: this.key
    });
  }
}
