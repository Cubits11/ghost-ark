import { RemovalPolicy } from "aws-cdk-lib";
import { IGrantable } from "aws-cdk-lib/aws-iam";
import { IKey, Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

export interface KmsSigningProps {
  stage: string;
  project?: string;
  aliasName?: string;
  keyArn?: string;
}

export class KmsSigning extends Construct {
  readonly aliasName: string;
  readonly key: IKey;
  readonly keyId: string;

  constructor(scope: Construct, id: string, props: KmsSigningProps) {
    super(scope, id);
    const project = props.project ?? "ghost-ark";
    this.aliasName = props.aliasName ?? `alias/${project}-${props.stage}-receipt-signing`;
    this.key =
      props.keyArn !== undefined
        ? Key.fromKeyArn(this, "ImportedReceiptSigningKey", props.keyArn)
        : new Key(this, "ReceiptSigningKey", {
            alias: this.aliasName,
            description: `Ghost Ark ${props.stage} asymmetric receipt signing key`,
            keySpec: KeySpec.RSA_2048,
            keyUsage: KeyUsage.SIGN_VERIFY,
            removalPolicy: props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
          });
    this.keyId = this.key.keyArn;
  }

  grantSign(grantee: IGrantable): void {
    this.key.grant(grantee, "kms:DescribeKey", "kms:GetPublicKey", "kms:Sign");
  }
}
