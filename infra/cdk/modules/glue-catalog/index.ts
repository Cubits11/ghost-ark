import { Stack } from "aws-cdk-lib";
import { CfnCrawler, CfnDatabase } from "aws-cdk-lib/aws-glue";
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface GlueCatalogProps {
  stage: string;
  curatedBucket: IBucket;
}

export class GlueCatalog extends Construct {
  readonly database: CfnDatabase;
  readonly crawler: CfnCrawler;
  readonly role: Role;

  constructor(scope: Construct, id: string, props: GlueCatalogProps) {
    super(scope, id);
    this.database = new CfnDatabase(this, "EvidenceDatabase", {
      catalogId: Stack.of(this).account,
      databaseInput: {
        name: `ghost_ark_${props.stage}`,
        description: "Ghost Ark curated evidence catalog"
      }
    });
    this.role = new Role(this, "GlueCrawlerRole", {
      assumedBy: new ServicePrincipal("glue.amazonaws.com"),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole")]
    });
    props.curatedBucket.grantRead(this.role);
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lakeformation:GetDataAccess"],
        resources: ["*"]
      })
    );
    this.crawler = new CfnCrawler(this, "CuratedEvidenceCrawler", {
      name: `ghost-ark-${props.stage}-curated-crawler`,
      databaseName: this.database.ref,
      role: this.role.roleArn,
      targets: {
        s3Targets: [{ path: `s3://${props.curatedBucket.bucketName}/tenants/` }]
      },
      schemaChangePolicy: {
        updateBehavior: "UPDATE_IN_DATABASE",
        deleteBehavior: "LOG"
      }
    });
  }
}
