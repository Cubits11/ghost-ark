import { PolicyStatement, IGrantable } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface KmsSigningProps {
  stage: string;
  project?: string;
  aliasName?: string;
  keyId?: string;
}

export class KmsSigning extends Construct {
  readonly aliasName: string;
  readonly keyId: string;

  constructor(scope: Construct, id: string, props: KmsSigningProps) {
    super(scope, id);
    const project = props.project ?? "ghost-ark";
    this.aliasName = props.aliasName ?? `alias/${project}-${props.stage}-receipt-signing`;
    this.keyId = props.keyId ?? this.aliasName;
  }

  grantSign(grantee: IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign"],
        resources: ["*"],
        conditions: {
          "ForAnyValue:StringEquals": {
            "kms:ResourceAliases": this.aliasName
          }
        }
      })
    );
  }
}
