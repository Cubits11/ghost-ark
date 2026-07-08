import path from "path";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AuthorizationType, CognitoUserPoolsAuthorizer, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { StringAttribute, UserPool } from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { DynamoDbLedger } from "../modules/dynamodb-ledger";
import { KmsSigning } from "../modules/kms-signing";
import { S3EvidenceLake } from "../modules/s3-evidence-lake";
import { GlueCatalog } from "../modules/glue-catalog";
import { AthenaWorkgroup } from "../modules/athena-workgroup";
import { LakeFormationGovernance } from "../modules/lakeformation-governance";
import { PrivacyVault } from "../modules/privacy-vault";
import { foundationModelArn } from "./utils/bedrock-model-arns";

export interface ApiStackProps extends StackProps {
  stage: string;
  project?: string;
  opensearchEndpoint?: string;
  opensearchDomainArn?: string;
  searchSecurityGroup?: ISecurityGroup;
  searchVpc?: IVpc;
  bedrockModelAllowlist?: string[];
  allowWildcardBedrockModels?: boolean;
}

function handlerEntry(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const project = props.project ?? "ghost-ark";
    const lake = new S3EvidenceLake(this, "EvidenceLake", { stage: props.stage, project });
    const searchEnabled = Boolean(props.opensearchEndpoint && props.opensearchDomainArn);
    const signing = new KmsSigning(this, "Signing", { stage: props.stage, project });
    const checkpointSigning = new KmsSigning(this, "CheckpointSigning", {
      stage: props.stage,
      project,
      aliasName: `alias/${project}-${props.stage}-receipt-epoch-signing`
    });
    const ledger = new DynamoDbLedger(this, "Ledger", { stage: props.stage });
    const privacyVault = new PrivacyVault(this, "PrivacyVault", { stage: props.stage });
    const bedrockModelAllowlist = props.bedrockModelAllowlist ?? [];
    const removalPolicy = props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const policyTable = new Table(this, "TenantPolicyTable", {
      tableName: `ghost-ark-${props.stage}-tenant-policies`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    const decisionReceiptTable = new Table(this, "DecisionReceiptTable", {
      tableName: `ghost-ark-${props.stage}-decision-receipts`,
      partitionKey: { name: "tenantId", type: AttributeType.STRING },
      sortKey: { name: "receiptId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    const executionNonceTable = new Table(this, "ExecutionNonceTable", {
      tableName: `ghost-ark-${props.stage}-execution-nonces`,
      partitionKey: { name: "reservationKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAtEpoch",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    const receiptCheckpointTable = new Table(this, "ReceiptCheckpointTable", {
      tableName: `ghost-ark-${props.stage}-receipt-checkpoints`,
      partitionKey: { name: "epochId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy
    });
    const decisionReceiptHmacSecret = new Secret(this, "DecisionReceiptHmacSecret", {
      secretName: `ghost-ark-${props.stage}-decision-receipt-hmac-secret`,
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true
      }
    });
    const catalog = new GlueCatalog(this, "Catalog", { stage: props.stage, curatedBucket: lake.curatedBucket });
    new AthenaWorkgroup(this, "Athena", { stage: props.stage, resultsBucket: lake.athenaResultsBucket });
    new LakeFormationGovernance(this, "Governance", { adminRole: catalog.role });

    const environment = {
      STAGE: props.stage,
      RECEIPT_LEDGER_TABLE: ledger.receipts.tableName,
      CLAIM_LEDGER_TABLE: ledger.claims.tableName,
      LINEAGE_LEDGER_TABLE: ledger.lineage.tableName,
      KMS_SIGNING_KEY_ID: signing.keyId,
      GHOST_ARK_MODEL_MODE: "bedrock",
      GHOST_ARK_RECEIPT_SIGNER: "kms",
      GHOST_ARK_POLICY_REPOSITORY: "dynamodb",
      GHOST_ARK_VAULT: "dynamodb",
      GHOST_ARK_DECISION_RECEIPT_REPOSITORY: "dynamodb",
      GHOST_ARK_POLICY_TABLE: policyTable.tableName,
      GHOST_ARK_PRIVACY_VAULT_TABLE: privacyVault.table.tableName,
      GHOST_ARK_DECISION_RECEIPT_TABLE: decisionReceiptTable.tableName,
      GHOST_ARK_EXECUTION_NONCE_TABLE: executionNonceTable.tableName,
      GHOST_ARK_RECEIPT_CHECKPOINT_TABLE: receiptCheckpointTable.tableName,
      GHOST_ARK_DECISION_SIGNING_KEY_ID: signing.keyId,
      GHOST_ARK_CHECKPOINT_SIGNING_KEY_ID: checkpointSigning.keyId,
      GHOST_ARK_RECEIPT_HMAC_SECRET_ARN: decisionReceiptHmacSecret.secretArn,
      GHOST_ARK_ALLOW_DEFAULT_POLICY: "false",
      GHOST_ARK_BEDROCK_MODEL_ALLOWLIST: bedrockModelAllowlist.join(","),
      GHOST_ARK_REJECT_CALLER_RETRIEVAL_CONTEXTS: "true",
      GHOST_ARK_REQUIRE_RETRIEVAL_PROVIDER: "true",
      OPENSEARCH_ENDPOINT: props.opensearchEndpoint ?? "",
      OPENSEARCH_INDEX_PREFIX: `ghost-ark-${props.stage}`,
      ALLOW_DEVELOPER_HEADERS: "false"
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
    const invokeGoverned = new NodejsFunction(this, "InvokeGovernedHandler", {
      runtime: Runtime.NODEJS_22_X,
      entry: handlerEntry("apps/api/src/handlers/invokeGoverned.ts"),
      handler: "handler",
      environment
    });
    const searchEvidence = searchEnabled
      ? new NodejsFunction(this, "SearchEvidenceHandler", {
          runtime: Runtime.NODEJS_22_X,
          entry: handlerEntry("apps/api/src/handlers/searchEvidence.ts"),
          handler: "handler",
          environment,
          ...searchVpcConfig
        })
      : undefined;

    ledger.receipts.grant(createReceipt, "dynamodb:PutItem");
    ledger.receipts.grant(getReceipt, "dynamodb:GetItem");
    ledger.claims.grant(createReceipt, "dynamodb:UpdateItem");
    ledger.claims.grant(listClaims, "dynamodb:Query");
    ledger.lineage.grant(createReceipt, "dynamodb:PutItem");
    policyTable.grantReadData(invokeGoverned);
    privacyVault.table.grantReadWriteData(invokeGoverned);
    invokeGoverned.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:TransactWriteItems"],
        resources: [decisionReceiptTable.tableArn]
      })
    );
    invokeGoverned.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [executionNonceTable.tableArn]
      })
    );
    decisionReceiptHmacSecret.grantRead(invokeGoverned);
    signing.grantSign(createReceipt);
    signing.grantSign(invokeGoverned);
    if (bedrockModelAllowlist.length > 0 || props.allowWildcardBedrockModels === true) {
      invokeGoverned.addToRolePolicy(
        new PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources:
            bedrockModelAllowlist.length > 0
              ? bedrockModelAllowlist.map((modelId) => foundationModelArn(modelId))
              : ["*"]
        })
      );
    }
    if (searchEvidence && props.opensearchDomainArn) {
      searchEvidence.addToRolePolicy(
        new PolicyStatement({
          actions: ["es:ESHttpGet", "es:ESHttpPost"],
          resources: [`${props.opensearchDomainArn}/*`]
        })
      );
    }

    const userPool = new UserPool(this, "ReceiptUserPool", {
      userPoolName: `${project}-${props.stage}-receipt-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      customAttributes: {
        tenant_slug: new StringAttribute({ minLen: 1, maxLen: 48, mutable: true })
      }
    });
    const userPoolClient = userPool.addClient("ReceiptApiClient", {
      userPoolClientName: `${project}-${props.stage}-receipt-api-client`,
      authFlows: {
        userPassword: true,
        userSrp: true
      }
    });
    const receiptAuthorizer = new CognitoUserPoolsAuthorizer(this, "ReceiptAuthorizer", {
      cognitoUserPools: [userPool]
    });
    const receiptMethodOptions = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: receiptAuthorizer
    };

    const api = new RestApi(this, "GhostArkApi", {
      restApiName: `ghost-ark-${props.stage}`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        tracingEnabled: true
      }
    });
    const receipts = api.root.addResource("receipts");
    receipts.addMethod("POST", new LambdaIntegration(createReceipt), receiptMethodOptions);
    const tenants = api.root.addResource("tenants");
    const tenant = tenants.addResource("{tenantSlug}");
    tenant.addResource("receipts").addResource("{receiptId}").addMethod("GET", new LambdaIntegration(getReceipt), receiptMethodOptions);
    tenant.addResource("claims").addMethod("GET", new LambdaIntegration(listClaims), receiptMethodOptions);
    tenant.addResource("invoke").addMethod("POST", new LambdaIntegration(invokeGoverned), receiptMethodOptions);
    if (searchEvidence) {
      tenant.addResource("search").addMethod("GET", new LambdaIntegration(searchEvidence), receiptMethodOptions);
    }

    const governedInvokeFailedClosed = new Metric({
      namespace: "GhostArk/GovernedInvoke",
      metricName: "GovernedInvokeFailedClosed",
      dimensionsMap: { stage: props.stage, status: "failed_closed" },
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const governedInvokeReceiptFailure = new Metric({
      namespace: "GhostArk/GovernedInvoke",
      metricName: "GovernedInvokeReceiptEmissionFailed",
      dimensionsMap: { stage: props.stage, status: "failed_closed" },
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const governedInvokeKmsSigningFailure = new Metric({
      namespace: "GhostArk/GovernedInvoke",
      metricName: "GovernedInvokeKmsSigningFailed",
      dimensionsMap: { stage: props.stage, status: "failed_closed" },
      statistic: "sum",
      period: Duration.minutes(5)
    });
    const governedInvokeBedrockFailure = new Metric({
      namespace: "GhostArk/GovernedInvoke",
      metricName: "GovernedInvokeBedrockFailed",
      dimensionsMap: { stage: props.stage, status: "failed_closed" },
      statistic: "sum",
      period: Duration.minutes(5)
    });

    new Alarm(this, "GovernedInvokeFailedClosedAlarm", {
      metric: governedInvokeFailedClosed,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    new Alarm(this, "GovernedInvokeReceiptEmissionFailureAlarm", {
      metric: governedInvokeReceiptFailure,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    new Alarm(this, "GovernedInvokeKmsSigningFailureAlarm", {
      metric: governedInvokeKmsSigningFailure,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    new Alarm(this, "GovernedInvokeBedrockFailureAlarm", {
      metric: governedInvokeBedrockFailure,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    new Alarm(this, "InvokeGovernedLambdaErrorsAlarm", {
      metric: invokeGoverned.metricErrors({ period: Duration.minutes(5), statistic: "sum" }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });
    new Alarm(this, "InvokeGovernedLambdaDurationHighAlarm", {
      metric: invokeGoverned.metricDuration({ period: Duration.minutes(5), statistic: "p99" }),
      threshold: 15000,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
    });

    new CfnOutput(this, "ReceiptUserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "ReceiptUserPoolClientId", { value: userPoolClient.userPoolClientId });
  }
}
