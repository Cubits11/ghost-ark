import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { EngineVersion, Domain } from "aws-cdk-lib/aws-opensearchservice";
import { Construct } from "constructs";

export interface SearchStackProps extends StackProps {
  stage: string;
}

export class SearchStack extends Stack {
  readonly domainEndpoint: string;
  readonly domainArn: string;
  readonly apiSearchSecurityGroup: SecurityGroup;
  readonly domainSecurityGroup: SecurityGroup;
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);
    this.vpc = new Vpc(this, "SearchVpc", { maxAzs: 2, natGateways: props.stage === "prod" ? 2 : 1 });
    this.domainSecurityGroup = new SecurityGroup(this, "SearchSecurityGroup", { vpc: this.vpc });
    this.apiSearchSecurityGroup = new SecurityGroup(this, "ApiSearchSecurityGroup", {
      vpc: this.vpc,
      description: "Attached to API Lambdas that need to reach the Ghost Ark OpenSearch endpoint."
    });
    this.domainSecurityGroup.addIngressRule(this.apiSearchSecurityGroup, Port.tcp(443), "Allow API search Lambda HTTPS to OpenSearch");
    const domain = new Domain(this, "EvidenceSearchDomain", {
      domainName: `ghost-ark-${props.stage}`,
      version: EngineVersion.OPENSEARCH_2_17,
      vpc: this.vpc,
      securityGroups: [this.domainSecurityGroup],
      capacity: {
        dataNodes: props.stage === "prod" ? 3 : 1,
        dataNodeInstanceType: props.stage === "prod" ? "r7g.large.search" : "t3.small.search"
      },
      ebs: {
        volumeSize: props.stage === "prod" ? 100 : 20
      },
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      removalPolicy: props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });
    this.domainEndpoint = `https://${domain.domainEndpoint}`;
    this.domainArn = domain.domainArn;
  }
}
