import { execFile, execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { KMSClient } from "@aws-sdk/client-kms";
import { privateHmacDigest } from "../../packages/enforcement-runtime/src/receipts/canonical";
import { KmsDecisionReceiptVerifier } from "../../packages/enforcement-runtime/src/receipts/kmsVerifier";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";
import {
  DecisionReceiptVerificationResult,
  parseDecisionReceiptSignatureEnvelope,
  verifyDecisionReceipt
} from "../../packages/enforcement-runtime/src/receipts/verifier";
import {
  buildSmokeGovernedInvokeReport,
  runSmokeGovernedInvoke,
  SmokeCaseReport,
  SmokeGovernedInvokeReport
} from "./smokeGovernedInvoke";

export const LIVE_SUPERVISED_AWS_RUNTIME_SCHEMA_VERSION = "ghost.live_supervised_aws_runtime_report.v1" as const;
export const LIVE_SUPERVISED_AWS_RUNTIME_NON_CLAIM =
  "This report is bounded runtime validation evidence only. It does not prove AI safety, production readiness, enterprise readiness, legal compliance, semantic correctness, empirical truth, or model-output correctness.";

export const forbiddenClaimsReminder = [
  "Do not claim production readiness.",
  "Do not claim enterprise readiness.",
  "Do not claim legal or compliance certification.",
  "Do not claim AI safety.",
  "Do not claim semantic correctness.",
  "Do not claim empirical truth.",
  "Do not claim model-output correctness.",
  "Do not claim local tests replace live AWS validation."
];

export type LiveCheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
export type LiveOverallVerdict = "PASS" | "PASS_WITH_NOT_RUN_OPTIONAL_CHECKS" | "FAIL" | "BLOCKED";
export type TaintedRetrievalReason = "NOT_RUN_PROVIDER_ABSENT" | "NOT_RUN_PROVIDER_CASE_NOT_CONFIGURED";

export interface SanitizedLiveCheck {
  status: LiveCheckStatus;
  details: Record<string, unknown>;
}

export interface LiveSmokeCaseReport extends SanitizedLiveCheck {
  name: string;
  httpStatus?: number;
  governedStatus?: string;
  receiptEmitted?: boolean;
  receiptId?: string;
  decisionPhases: SmokeCaseReport["decisionPhases"];
  reason?: TaintedRetrievalReason;
}

export interface LiveReceiptVerificationReport extends SanitizedLiveCheck {
  receiptId?: string;
  keyIdHash?: string;
  checks: { name: string; passed?: boolean }[];
}

export interface LiveProviderStatus extends SanitizedLiveCheck {
  provider: "opensearch-sigv4" | "none";
  taintedRetrievalCase: {
    status: LiveCheckStatus;
    reason: TaintedRetrievalReason;
  };
}

export interface LiveSupervisedAwsRuntimeReport {
  schemaVersion: typeof LIVE_SUPERVISED_AWS_RUNTIME_SCHEMA_VERSION;
  generatedAt: string;
  stage: string;
  region: string;
  apiHostHash: string;
  tenantHash: string;
  modelId: string;
  commitSha?: string;
  configurationValidation: SanitizedLiveCheck;
  smokeCases: LiveSmokeCaseReport[];
  receiptVerification: LiveReceiptVerificationReport;
  cloudWatchLogCheck: SanitizedLiveCheck;
  cloudWatchMetricAlarmCheck: SanitizedLiveCheck;
  iamAccessAnalyzerCheck: SanitizedLiveCheck;
  providerStatus: LiveProviderStatus;
  reportRedactionCheck: SanitizedLiveCheck;
  overallVerdict: LiveOverallVerdict;
  nonClaim: string;
  forbiddenClaimsReminder: string[];
}

export interface SupervisedAwsRuntimeValidationArgs {
  api?: string;
  token?: string;
  tenant?: string;
  stage?: string;
  model?: string;
  decisionReceiptTable?: string;
  receiptHmacSecretId?: string;
  region?: string;
  jsonReport?: string;
  logGroup?: string;
  checkCloudWatchLogs: boolean;
  checkCloudWatchAlarms: boolean;
  metricNamespace: string;
  alarmNamePrefixes: string[];
  alarmNames: string[];
  accessAnalyzerArn?: string;
  retrievalProvider: "absent" | "present";
}

export interface ForbiddenValue {
  label: string;
  value?: string;
}

export interface AwsCliResult {
  stdout: string;
  stderr: string;
}

export type AwsCliRunner = (args: string[]) => Promise<AwsCliResult>;

interface ReceiptVerificationOptions {
  readSecret?: (secretId: string, region: string) => Promise<string>;
  getReceipt?: (input: {
    tableName: string;
    tenantId: string;
    receiptId: string;
    region: string;
  }) => Promise<SignedDecisionReceipt | null>;
  verifyReceipt?: (receipt: SignedDecisionReceipt, keyId: string, region: string) => Promise<DecisionReceiptVerificationResult>;
}

const defaultMetricNamespace = "GhostArk/GovernedInvoke";
const defaultAlarmNamePrefixes = ["GovernedInvoke", "InvokeGovernedLambda"];
const benignPrompt = "Summarize this benign validation request in one sentence.";
const privateMemoryPrompt = "extract private memory for this user";
const tenantOverrideFixture = "attacker-tenant";
const crossTenantRetrievalText = "cross tenant smoke fixture";

function requiredArgNames(): Array<{ key: keyof SupervisedAwsRuntimeValidationArgs; label: string }> {
  return [
    { key: "api", label: "apiUrl" },
    { key: "token", label: "cognitoToken" },
    { key: "tenant", label: "tenantSlug" },
    { key: "stage", label: "stage" },
    { key: "model", label: "modelId" },
    { key: "decisionReceiptTable", label: "decisionReceiptTable" },
    { key: "receiptHmacSecretId", label: "receiptHmacSecretId" },
    { key: "region", label: "region" }
  ];
}

function isPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256Label(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function apiHostHash(api: string | undefined): string {
  if (!api) {
    return sha256Label("missing-api");
  }
  try {
    const parsed = new URL(api);
    return sha256Label(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return sha256Label(api);
  }
}

function tenantHash(tenant: string | undefined): string {
  return sha256Label(tenant ?? "missing-tenant");
}

function sanitizeText(value: string, forbiddenValues: ForbiddenValue[]): string {
  let sanitized = value;
  for (const forbidden of forbiddenValues) {
    if (forbidden.value && forbidden.value.length > 0) {
      sanitized = sanitized.split(forbidden.value).join(`[REDACTED:${forbidden.label}]`);
    }
  }
  return sanitized;
}

function safeErrorMessage(error: unknown, forbiddenValues: ForbiddenValue[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeText(message, forbiddenValues).slice(0, 500);
}

function parseJsonOutput(stdout: string): Record<string, unknown> {
  if (stdout.trim().length === 0) {
    return {};
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

function defaultAwsCliRunner(args: string[]): Promise<AwsCliResult> {
  return new Promise((resolve, reject) => {
    execFile("aws", args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function gitCommitSha(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function parseSupervisedAwsRuntimeValidationArgs(argv: string[]): SupervisedAwsRuntimeValidationArgs {
  const args: SupervisedAwsRuntimeValidationArgs = {
    checkCloudWatchLogs: false,
    checkCloudWatchAlarms: false,
    metricNamespace: defaultMetricNamespace,
    alarmNamePrefixes: [],
    alarmNames: [],
    retrievalProvider: "absent"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--api") {
      args.api = next;
      index += 1;
    } else if (arg === "--token") {
      args.token = next;
      index += 1;
    } else if (arg === "--tenant") {
      args.tenant = next;
      index += 1;
    } else if (arg === "--stage") {
      args.stage = next;
      index += 1;
    } else if (arg === "--model") {
      args.model = next;
      index += 1;
    } else if (arg === "--decision-receipt-table") {
      args.decisionReceiptTable = next;
      index += 1;
    } else if (arg === "--receipt-hmac-secret-id") {
      args.receiptHmacSecretId = next;
      index += 1;
    } else if (arg === "--region") {
      args.region = next;
      index += 1;
    } else if (arg === "--json-report") {
      args.jsonReport = next;
      index += 1;
    } else if (arg === "--log-group") {
      args.logGroup = next;
      index += 1;
    } else if (arg === "--check-cloudwatch-logs") {
      args.checkCloudWatchLogs = true;
    } else if (arg === "--check-cloudwatch-alarms") {
      args.checkCloudWatchAlarms = true;
    } else if (arg === "--metric-namespace") {
      args.metricNamespace = next;
      index += 1;
    } else if (arg === "--alarm-name-prefix") {
      args.alarmNamePrefixes.push(next);
      index += 1;
    } else if (arg === "--alarm-name") {
      args.alarmNames.push(next);
      index += 1;
    } else if (arg === "--access-analyzer-arn") {
      args.accessAnalyzerArn = next;
      index += 1;
    } else if (arg === "--retrieval-provider") {
      if (next !== "absent" && next !== "present") {
        throw new Error("--retrieval-provider must be absent or present");
      }
      args.retrievalProvider = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.alarmNamePrefixes.length === 0) {
    args.alarmNamePrefixes = defaultAlarmNamePrefixes;
  }

  return args;
}

export function buildForbiddenValues(args: SupervisedAwsRuntimeValidationArgs, extras: ForbiddenValue[] = []): ForbiddenValue[] {
  return [
    { label: "token", value: args.token },
    { label: "tenant", value: args.tenant },
    { label: "benignPrompt", value: benignPrompt },
    { label: "privateMemoryPrompt", value: privateMemoryPrompt },
    { label: "tenantOverrideFixture", value: tenantOverrideFixture },
    { label: "crossTenantRetrievalText", value: crossTenantRetrievalText },
    ...extras
  ].filter((entry) => entry.value && entry.value.length > 0);
}

export function buildConfigurationValidation(args: SupervisedAwsRuntimeValidationArgs): SanitizedLiveCheck {
  const present: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const required of requiredArgNames()) {
    const hasValue = isPresent(args[required.key]);
    present[required.label] = hasValue;
    if (!hasValue) {
      missing.push(required.label);
    }
  }

  return {
    status: missing.length === 0 ? "PASS" : "FAIL",
    details: {
      requiredPresent: present,
      missing,
      apiHostHash: apiHostHash(args.api),
      tenantHash: tenantHash(args.tenant),
      decisionReceiptTableHash: args.decisionReceiptTable ? sha256Label(args.decisionReceiptTable) : undefined,
      receiptHmacSecretIdHash: args.receiptHmacSecretId ? sha256Label(args.receiptHmacSecretId) : undefined,
      region: args.region ?? "missing"
    }
  };
}

export function smokeCasesForLiveReport(
  smokeReport: SmokeGovernedInvokeReport | undefined,
  providerStatus: LiveProviderStatus
): LiveSmokeCaseReport[] {
  const cases: LiveSmokeCaseReport[] =
    smokeReport?.cases.map<LiveSmokeCaseReport>((smokeCase) => ({
      name: smokeCase.name,
      status: smokeCase.passed ? "PASS" : "FAIL",
      httpStatus: smokeCase.httpStatus,
      governedStatus: smokeCase.governedStatus,
      receiptEmitted: smokeCase.receiptEmitted,
      receiptId: smokeCase.receiptId,
      decisionPhases: smokeCase.decisionPhases,
      details: {
        expectedRuntimeCase: true
      }
    })) ?? [];

  cases.push({
    name: "tainted-retrieval-provider",
    status: providerStatus.taintedRetrievalCase.status,
    reason: providerStatus.taintedRetrievalCase.reason,
    decisionPhases: [],
    details: {
      provider: providerStatus.provider,
      reason: providerStatus.taintedRetrievalCase.reason
    }
  });

  return cases;
}

export function buildProviderStatus(args: SupervisedAwsRuntimeValidationArgs): LiveProviderStatus {
  if (args.retrievalProvider === "present") {
    return {
      provider: "opensearch-sigv4",
      status: "BLOCKED",
      taintedRetrievalCase: {
        status: "NOT_RUN",
        reason: "NOT_RUN_PROVIDER_CASE_NOT_CONFIGURED"
      },
      details: {
        serverSideProviderDeclared: true,
        automatedTaintedRetrievalCase: "not configured in the supervisor without a provider-specific seed/query contract"
      }
    };
  }

  return {
    provider: "none",
    status: "NOT_RUN",
    taintedRetrievalCase: {
      status: "NOT_RUN",
      reason: "NOT_RUN_PROVIDER_ABSENT"
    },
    details: {
      serverSideProviderDeclared: false,
      reason: "No production OpenSearch/SigV4 or other server-side retrieval provider is wired for this validation lane."
    }
  };
}

export function assertLiveReportRedacted(
  report: Omit<LiveSupervisedAwsRuntimeReport, "reportRedactionCheck" | "overallVerdict">,
  forbiddenValues: ForbiddenValue[]
): SanitizedLiveCheck {
  const text = JSON.stringify(report);
  const forbiddenLabelsFound = forbiddenValues
    .filter((entry) => entry.value && entry.value.length > 0 && text.includes(entry.value))
    .map((entry) => entry.label)
    .sort();
  return {
    status: forbiddenLabelsFound.length === 0 ? "PASS" : "FAIL",
    details: {
      forbiddenLabelsChecked: forbiddenValues.map((entry) => entry.label).sort(),
      forbiddenLabelsFound
    }
  };
}

async function defaultReadSecret(secretId: string, region: string): Promise<string> {
  const client = new SecretsManagerClient({ region });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString("utf8") : "");
  if (value.trim().length === 0) {
    throw new Error("Secrets Manager returned an empty HMAC secret");
  }
  return value;
}

async function defaultGetReceipt(input: {
  tableName: string;
  tenantId: string;
  receiptId: string;
  region: string;
}): Promise<SignedDecisionReceipt | null> {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: input.region }));
  const response = await client.send(
    new GetCommand({
      TableName: input.tableName,
      Key: { tenantId: input.tenantId, receiptId: input.receiptId },
      ConsistentRead: true
    })
  );
  return response.Item?.receipt ? validateSignedDecisionReceipt(response.Item.receipt) : null;
}

async function defaultVerifyReceipt(
  receipt: SignedDecisionReceipt,
  keyId: string,
  region: string
): Promise<DecisionReceiptVerificationResult> {
  return verifyDecisionReceipt(receipt, new KmsDecisionReceiptVerifier({ keyId, client: new KMSClient({ region }) }));
}

function receiptIdFromSmokeReport(smokeReport: SmokeGovernedInvokeReport | undefined): string | undefined {
  return smokeReport?.cases.find((entry) => entry.receiptEmitted === true && entry.receiptId)?.receiptId;
}

export async function verifyKmsReceiptFromSmokeReport(input: {
  smokeReport?: SmokeGovernedInvokeReport;
  args: SupervisedAwsRuntimeValidationArgs;
  forbiddenValues?: ForbiddenValue[];
  options?: ReceiptVerificationOptions;
}): Promise<LiveReceiptVerificationReport> {
  const forbiddenValues = input.forbiddenValues ?? buildForbiddenValues(input.args);
  const receiptId = receiptIdFromSmokeReport(input.smokeReport);
  if (!receiptId) {
    return {
      status: "FAIL",
      checks: [{ name: "receipt_present", passed: false }],
      details: {
        reason: "No emitted receipt ID was available in the sanitized smoke report."
      }
    };
  }

  if (!input.args.tenant || !input.args.receiptHmacSecretId || !input.args.decisionReceiptTable || !input.args.region) {
    return {
      status: "BLOCKED",
      receiptId,
      checks: [{ name: "configuration", passed: false }],
      details: {
        reason: "Receipt verification requires tenant, HMAC secret id, decision receipt table, and region."
      }
    };
  }

  try {
    const readSecret = input.options?.readSecret ?? defaultReadSecret;
    const getReceipt = input.options?.getReceipt ?? defaultGetReceipt;
    const verifyReceipt = input.options?.verifyReceipt ?? defaultVerifyReceipt;
    const hmacSecret = await readSecret(input.args.receiptHmacSecretId, input.args.region);
    const tenantId = privateHmacDigest(hmacSecret, input.args.tenant);
    const receipt = await getReceipt({
      tableName: input.args.decisionReceiptTable,
      tenantId,
      receiptId,
      region: input.args.region
    });

    if (!receipt) {
      return {
        status: "FAIL",
        receiptId,
        checks: [{ name: "receipt_found", passed: false }],
        details: {
          tenantDigestHash: sha256Label(tenantId),
          reason: "Decision receipt was not found with a consistent DynamoDB read."
        }
      };
    }

    const envelope = parseDecisionReceiptSignatureEnvelope(receipt.receipt_signature);
    const keyId = typeof envelope.keyId === "string" ? envelope.keyId : "";
    if (!keyId) {
      return {
        status: "FAIL",
        receiptId,
        checks: [{ name: "signature_envelope_key_id", passed: false }],
        details: {
          reason: "Receipt signature envelope did not contain a KMS key id."
        }
      };
    }

    const result = await verifyReceipt(receipt, keyId, input.args.region);
    return {
      status: result.verdict ? "PASS" : "FAIL",
      receiptId,
      keyIdHash: sha256Label(keyId),
      checks: result.checks.map((check) => ({ name: check.name, passed: check.passed })),
      details: {
        verifier: "KmsDecisionReceiptVerifier",
        algorithm: receipt.signature_alg,
        tenantDigestHash: sha256Label(tenantId)
      }
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      receiptId,
      checks: [{ name: "aws_receipt_verification", passed: false }],
      details: {
        reason: safeErrorMessage(error, forbiddenValues)
      }
    };
  }
}

export async function runCloudWatchLogRedactionCheck(input: {
  args: SupervisedAwsRuntimeValidationArgs;
  forbiddenValues: ForbiddenValue[];
  runner?: AwsCliRunner;
  nowMs?: number;
}): Promise<SanitizedLiveCheck> {
  if (!input.args.checkCloudWatchLogs || !input.args.logGroup || !input.args.region) {
    return {
      status: "NOT_RUN",
      details: {
        reason: "CloudWatch log redaction check requires --check-cloudwatch-logs, --log-group, and --region.",
        operatorCommand:
          'aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$(node -e \'console.log(Date.now() - 3600_000)\')" --max-items 50'
      }
    };
  }

  const runner = input.runner ?? defaultAwsCliRunner;
  const startTime = String((input.nowMs ?? Date.now()) - 60 * 60 * 1000);
  try {
    const response = await runner([
      "logs",
      "filter-log-events",
      "--log-group-name",
      input.args.logGroup,
      "--start-time",
      startTime,
      "--max-items",
      "50",
      "--region",
      input.args.region,
      "--output",
      "json"
    ]);
    const parsed = parseJsonOutput(response.stdout);
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const eventText = JSON.stringify(events);
    const forbiddenLabelsFound = input.forbiddenValues
      .filter((entry) => entry.value && eventText.includes(entry.value))
      .map((entry) => entry.label)
      .sort();
    return {
      status: forbiddenLabelsFound.length === 0 ? "PASS" : "FAIL",
      details: {
        eventsScanned: events.length,
        forbiddenLabelsChecked: input.forbiddenValues.map((entry) => entry.label).sort(),
        forbiddenLabelsFound
      }
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      details: {
        reason: safeErrorMessage(error, input.forbiddenValues)
      }
    };
  }
}

export async function runCloudWatchMetricAlarmCheck(input: {
  args: SupervisedAwsRuntimeValidationArgs;
  forbiddenValues?: ForbiddenValue[];
  runner?: AwsCliRunner;
}): Promise<SanitizedLiveCheck> {
  if (!input.args.checkCloudWatchAlarms || !input.args.region) {
    return {
      status: "NOT_RUN",
      details: {
        reason: "CloudWatch metric/alarm check requires --check-cloudwatch-alarms and --region.",
        operatorCommands: [
          `aws cloudwatch list-metrics --namespace "${input.args.metricNamespace}"`,
          'aws cloudwatch describe-alarms --alarm-name-prefix "GovernedInvoke"',
          'aws cloudwatch describe-alarms --alarm-name-prefix "InvokeGovernedLambda"'
        ]
      }
    };
  }

  const runner = input.runner ?? defaultAwsCliRunner;
  const forbiddenValues = input.forbiddenValues ?? buildForbiddenValues(input.args);
  try {
    const metricResponse = await runner([
      "cloudwatch",
      "list-metrics",
      "--namespace",
      input.args.metricNamespace,
      "--region",
      input.args.region,
      "--output",
      "json"
    ]);
    const metricJson = parseJsonOutput(metricResponse.stdout);
    const metrics = Array.isArray(metricJson.Metrics) ? metricJson.Metrics : [];

    const alarmNamesObserved = new Set<string>();
    for (const alarmName of input.args.alarmNames) {
      const alarmResponse = await runner([
        "cloudwatch",
        "describe-alarms",
        "--alarm-names",
        alarmName,
        "--region",
        input.args.region,
        "--output",
        "json"
      ]);
      const alarmJson = parseJsonOutput(alarmResponse.stdout);
      for (const alarm of Array.isArray(alarmJson.MetricAlarms) ? alarmJson.MetricAlarms : []) {
        const observed = (alarm as Record<string, unknown>).AlarmName;
        if (typeof observed === "string") {
          alarmNamesObserved.add(observed);
        }
      }
    }

    for (const prefix of input.args.alarmNamePrefixes) {
      const alarmResponse = await runner([
        "cloudwatch",
        "describe-alarms",
        "--alarm-name-prefix",
        prefix,
        "--region",
        input.args.region,
        "--output",
        "json"
      ]);
      const alarmJson = parseJsonOutput(alarmResponse.stdout);
      for (const alarm of Array.isArray(alarmJson.MetricAlarms) ? alarmJson.MetricAlarms : []) {
        const observed = (alarm as Record<string, unknown>).AlarmName;
        if (typeof observed === "string") {
          alarmNamesObserved.add(observed);
        }
      }
    }

    const missingExplicitAlarms = input.args.alarmNames.filter((name) => !alarmNamesObserved.has(name));
    const passed = metrics.length > 0 && missingExplicitAlarms.length === 0;
    return {
      status: passed ? "PASS" : "FAIL",
      details: {
        metricNamespace: input.args.metricNamespace,
        metricCount: metrics.length,
        alarmNamesChecked: input.args.alarmNames,
        alarmNamePrefixesChecked: input.args.alarmNamePrefixes,
        observedAlarmCount: alarmNamesObserved.size,
        missingExplicitAlarmCount: missingExplicitAlarms.length
      }
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      details: {
        reason: safeErrorMessage(error, forbiddenValues)
      }
    };
  }
}

export async function runIamAccessAnalyzerCheck(input: {
  args: SupervisedAwsRuntimeValidationArgs;
  forbiddenValues?: ForbiddenValue[];
  runner?: AwsCliRunner;
}): Promise<SanitizedLiveCheck> {
  if (!input.args.accessAnalyzerArn || !input.args.region) {
    return {
      status: "NOT_RUN",
      details: {
        reason: "IAM Access Analyzer check requires --access-analyzer-arn and --region.",
        operatorCommands: [
          "aws accessanalyzer list-analyzers",
          'aws accessanalyzer list-findings --analyzer-arn "$ACCESS_ANALYZER_ARN"'
        ]
      }
    };
  }

  const runner = input.runner ?? defaultAwsCliRunner;
  const forbiddenValues = input.forbiddenValues ?? buildForbiddenValues(input.args);
  try {
    const response = await runner([
      "accessanalyzer",
      "list-findings",
      "--analyzer-arn",
      input.args.accessAnalyzerArn,
      "--region",
      input.args.region,
      "--output",
      "json"
    ]);
    const parsed = parseJsonOutput(response.stdout);
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const activeFindingCount = findings.filter((finding) => {
      const record = finding as Record<string, unknown>;
      return record.status === "ACTIVE";
    }).length;
    return {
      status: activeFindingCount === 0 ? "PASS" : "FAIL",
      details: {
        findingsScanned: findings.length,
        activeFindingCount
      }
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      details: {
        reason: safeErrorMessage(error, forbiddenValues)
      }
    };
  }
}

export function deriveOverallVerdict(input: {
  configurationValidation: SanitizedLiveCheck;
  smokeCases: LiveSmokeCaseReport[];
  receiptVerification: LiveReceiptVerificationReport;
  cloudWatchLogCheck: SanitizedLiveCheck;
  cloudWatchMetricAlarmCheck: SanitizedLiveCheck;
  iamAccessAnalyzerCheck: SanitizedLiveCheck;
  providerStatus: LiveProviderStatus;
  reportRedactionCheck: SanitizedLiveCheck;
}): LiveOverallVerdict {
  const requiredStatuses: LiveCheckStatus[] = [
    input.configurationValidation.status,
    input.receiptVerification.status,
    input.reportRedactionCheck.status,
    ...input.smokeCases.filter((entry) => entry.name !== "tainted-retrieval-provider").map((entry) => entry.status)
  ];
  const optionalStatuses: LiveCheckStatus[] = [
    input.cloudWatchLogCheck.status,
    input.cloudWatchMetricAlarmCheck.status,
    input.iamAccessAnalyzerCheck.status,
    input.providerStatus.status,
    ...input.smokeCases.filter((entry) => entry.name === "tainted-retrieval-provider").map((entry) => entry.status)
  ];
  const allStatuses = [...requiredStatuses, ...optionalStatuses];
  if (allStatuses.includes("FAIL")) {
    return "FAIL";
  }
  if (allStatuses.includes("BLOCKED")) {
    return "BLOCKED";
  }
  if (requiredStatuses.includes("NOT_RUN")) {
    return "BLOCKED";
  }
  if (optionalStatuses.includes("NOT_RUN")) {
    return "PASS_WITH_NOT_RUN_OPTIONAL_CHECKS";
  }
  return "PASS";
}

export function buildLiveSupervisedAwsRuntimeReport(input: {
  args: SupervisedAwsRuntimeValidationArgs;
  configurationValidation: SanitizedLiveCheck;
  smokeReport?: SmokeGovernedInvokeReport;
  receiptVerification: LiveReceiptVerificationReport;
  cloudWatchLogCheck: SanitizedLiveCheck;
  cloudWatchMetricAlarmCheck: SanitizedLiveCheck;
  iamAccessAnalyzerCheck: SanitizedLiveCheck;
  providerStatus: LiveProviderStatus;
  forbiddenValues: ForbiddenValue[];
  generatedAt?: string;
  commitSha?: string;
}): LiveSupervisedAwsRuntimeReport {
  const smokeCases = smokeCasesForLiveReport(input.smokeReport, input.providerStatus);
  const reportWithoutRedactionAndVerdict = {
    schemaVersion: LIVE_SUPERVISED_AWS_RUNTIME_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    stage: input.args.stage ?? "unknown",
    region: input.args.region ?? "unknown",
    apiHostHash: input.smokeReport?.apiHostHash ?? apiHostHash(input.args.api),
    tenantHash: input.smokeReport?.tenantHash ?? tenantHash(input.args.tenant),
    modelId: input.args.model ?? "unknown",
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    configurationValidation: input.configurationValidation,
    smokeCases,
    receiptVerification: input.receiptVerification,
    cloudWatchLogCheck: input.cloudWatchLogCheck,
    cloudWatchMetricAlarmCheck: input.cloudWatchMetricAlarmCheck,
    iamAccessAnalyzerCheck: input.iamAccessAnalyzerCheck,
    providerStatus: input.providerStatus,
    nonClaim: LIVE_SUPERVISED_AWS_RUNTIME_NON_CLAIM,
    forbiddenClaimsReminder
  };
  const reportRedactionCheck = assertLiveReportRedacted(reportWithoutRedactionAndVerdict, input.forbiddenValues);
  const overallVerdict = deriveOverallVerdict({
    configurationValidation: input.configurationValidation,
    smokeCases,
    receiptVerification: input.receiptVerification,
    cloudWatchLogCheck: input.cloudWatchLogCheck,
    cloudWatchMetricAlarmCheck: input.cloudWatchMetricAlarmCheck,
    iamAccessAnalyzerCheck: input.iamAccessAnalyzerCheck,
    providerStatus: input.providerStatus,
    reportRedactionCheck
  });
  return {
    ...reportWithoutRedactionAndVerdict,
    reportRedactionCheck,
    overallVerdict
  };
}

export function writeLiveSupervisedAwsRuntimeReport(filePath: string, report: LiveSupervisedAwsRuntimeReport): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printUsage(): void {
  console.log(`Ghost Ark supervised live AWS runtime validation

Usage:
  npm run supervised:aws-runtime-validation -- \\
    --api "$API_URL" \\
    --token "$ID_TOKEN" \\
    --tenant "$TENANT" \\
    --stage "$STAGE" \\
    --model "$MODEL_ID" \\
    --decision-receipt-table "$DECISION_RECEIPT_TABLE" \\
    --receipt-hmac-secret-id "$RECEIPT_HMAC_SECRET_ID" \\
    --region "$AWS_REGION" \\
    --json-report "$REPORT_PATH"

Optional checks:
  --check-cloudwatch-logs --log-group "$LOG_GROUP"
  --check-cloudwatch-alarms --alarm-name-prefix "GovernedInvoke" --alarm-name-prefix "InvokeGovernedLambda"
  --access-analyzer-arn "$ACCESS_ANALYZER_ARN"
  --retrieval-provider absent

The script never prints the token, tenant slug, raw prompts, raw model outputs, raw secrets, raw users, raw sessions, or raw retrieval text.
`);
}

async function main(): Promise<void> {
  const args = parseSupervisedAwsRuntimeValidationArgs(process.argv.slice(2));
  const forbiddenValues = buildForbiddenValues(args);
  const configurationValidation = buildConfigurationValidation(args);
  const providerStatus = buildProviderStatus(args);
  let smokeReport: SmokeGovernedInvokeReport | undefined;
  let receiptVerification: LiveReceiptVerificationReport = {
    status: "NOT_RUN",
    checks: [],
    details: {
      reason: "Receipt verification did not run because configuration validation did not pass."
    }
  };

  if (configurationValidation.status === "PASS") {
    const smokeArgs = {
      api: args.api as string,
      token: args.token as string,
      tenant: args.tenant as string,
      model: args.model as string,
      stage: args.stage,
      expectedMode: "live-supervised-aws-runtime"
    };
    const smokeResults = await runSmokeGovernedInvoke(smokeArgs);
    smokeReport = buildSmokeGovernedInvokeReport({ args: smokeArgs, results: smokeResults });
    receiptVerification = await verifyKmsReceiptFromSmokeReport({
      smokeReport,
      args,
      forbiddenValues
    });
  }

  const [cloudWatchLogCheck, cloudWatchMetricAlarmCheck, iamAccessAnalyzerCheck] = await Promise.all([
    runCloudWatchLogRedactionCheck({ args, forbiddenValues }),
    runCloudWatchMetricAlarmCheck({ args, forbiddenValues }),
    runIamAccessAnalyzerCheck({ args, forbiddenValues })
  ]);

  const report = buildLiveSupervisedAwsRuntimeReport({
    args,
    configurationValidation,
    smokeReport,
    receiptVerification,
    cloudWatchLogCheck,
    cloudWatchMetricAlarmCheck,
    iamAccessAnalyzerCheck,
    providerStatus,
    forbiddenValues,
    commitSha: gitCommitSha()
  });

  if (args.jsonReport) {
    writeLiveSupervisedAwsRuntimeReport(args.jsonReport, report);
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        overallVerdict: report.overallVerdict,
        reportPath: args.jsonReport,
        smokeCases: report.smokeCases.map((entry) => ({ name: entry.name, status: entry.status, reason: entry.reason })),
        receiptVerification: report.receiptVerification.status,
        cloudWatchLogCheck: report.cloudWatchLogCheck.status,
        cloudWatchMetricAlarmCheck: report.cloudWatchMetricAlarmCheck.status,
        iamAccessAnalyzerCheck: report.iamAccessAnalyzerCheck.status,
        providerStatus: report.providerStatus.status,
        nonClaim: report.nonClaim
      },
      null,
      2
    )
  );

  if (report.overallVerdict === "FAIL" || report.overallVerdict === "BLOCKED") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    let forbiddenValues: ForbiddenValue[] = [];
    try {
      forbiddenValues = buildForbiddenValues(parseSupervisedAwsRuntimeValidationArgs(process.argv.slice(2)));
    } catch {
      forbiddenValues = [];
    }
    console.error(safeErrorMessage(error, forbiddenValues));
    process.exitCode = 1;
  });
}
