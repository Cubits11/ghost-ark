import path from "path";
import { Stack, StackProps } from "aws-cdk-lib";
import { RestApi, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { DynamoDbLedger } from "../modules/dynamodb-ledger";
import { KmsSigning } from "../modules/kms-signing";
import { S3EvidenceLake } from "../modules/s3-evidence-lake";
import { GlueCatalog } from "../modules/glue-catalog";
import { AthenaWorkgroup } from "../modules/athena-workgroup";
import { LakeFormationGovernance } from "../modules/lakeformation-governance";

export interface ApiStackProps extends StackProps {
  stage: string;
  project?: string;
  opensearchEndpoint?: string;
  searchSecurityGroup?: ISecurityGroup;
  searchVpc?: IVpc;
}

function handlerEntry(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const project = props.project ?? "ghost-ark";
    const lake = new S3EvidenceLake(this, "EvidenceLake", { stage: props.stage, project });
    if (!props.opensearchEndpoint) {
      throw new Error("ApiStack requires an OpenSearch endpoint from SearchStack");
    }
    const signing = new KmsSigning(this, "Signing", { stage: props.stage, project });
    const ledger = new DynamoDbLedger(this, "Ledger", { stage: props.stage });
    const catalog = new GlueCatalog(this, "Catalog", { stage: props.stage, curatedBucket: lake.curatedBucket });
    new AthenaWorkgroup(this, "Athena", { stage: props.stage, resultsBucket: lake.athenaResultsBucket });
    new LakeFormationGovernance(this, "Governance", { adminRole: catalog.role });

    const environment = {
      STAGE: props.stage,
      RECEIPT_LEDGER_TABLE: ledger.receipts.tableName,
      CLAIM_LEDGER_TABLE: ledger.claims.tableName,
      LINEAGE_LEDGER_TABLE: ledger.lineage.tableName,
      KMS_SIGNING_KEY_ID: signing.keyId,
      OPENSEARCH_ENDPOINT: props.opensearchEndpoint,
      OPENSEARCH_INDEX_PREFIX: `ghost-ark-${props.stage}`,
      ALLOW_DEVELOPER_HEADERS: props.stage === "prod" ? "false" : "true"
    };
    let searchVpcConfig: Pick<NodejsFunctionProps, "vpc" | "securityGroups"> = {};
    if (props.searchVpc && props.searchSecurityGroup) {
      searchVpcConfig = {
        vpc: props.searchVpc,
        securityGroups: [props.searchSecurityGroup]
      };
    }

    const createReceipt = new NodejsFunction(this, "CreateReceiptHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: handlerEntry("apps/api/src/handlers/createReceipt.ts"),
      handler: "handler",
      environment
    });
    const getReceipt = new NodejsFunction(this, "GetReceiptHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: handlerEntry("apps/api/src/handlers/getReceipt.ts"),
      handler: "handler",
      environment
    });
    const listClaims = new NodejsFunction(this, "ListClaimsHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: handlerEntry("apps/api/src/handlers/listClaims.ts"),
      handler: "handler",
      environment
    });
    const searchEvidence = new NodejsFunction(this, "SearchEvidenceHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: handlerEntry("apps/api/src/handlers/searchEvidence.ts"),
      handler: "handler",
      environment,
      ...searchVpcConfig
    });

    for (const fn of [createReceipt, getReceipt, listClaims]) {
      ledger.receipts.grantReadWriteData(fn);
      ledger.claims.grantReadWriteData(fn);
      ledger.lineage.grantReadWriteData(fn);
    }
    signing.grantSign(createReceipt);
    searchEvidence.addToRolePolicy(
      new PolicyStatement({
        actions: ["es:ESHttpGet", "es:ESHttpPost"],
        resources: ["*"]
      })
    );

    const api = new RestApi(this, "GhostArkApi", {
      restApiName: `ghost-ark-${props.stage}`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        tracingEnabled: true
      }
    });
    const receipts = api.root.addResource("receipts");
    receipts.addMethod("POST", new LambdaIntegration(createReceipt));
    const tenants = api.root.addResource("tenants");
    const tenant = tenants.addResource("{tenantSlug}");
    tenant.addResource("receipts").addResource("{receiptId}").addMethod("GET", new LambdaIntegration(getReceipt));
    tenant.addResource("claims").addMethod("GET", new LambdaIntegration(listClaims));
    tenant.addResource("search").addMethod("GET", new LambdaIntegration(searchEvidence));
  }
}
