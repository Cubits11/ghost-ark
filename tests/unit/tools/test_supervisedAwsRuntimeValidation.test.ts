import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { SignedDecisionReceipt } from "../../../packages/enforcement-runtime/src/receipts/schema";
import { buildSmokeGovernedInvokeReport } from "../../../tools/scripts/smokeGovernedInvoke";
import {
  buildConfigurationValidation,
  buildForbiddenValues,
  buildLiveSupervisedAwsRuntimeReport,
  buildProviderStatus,
  LIVE_SUPERVISED_AWS_RUNTIME_NON_CLAIM,
  runCloudWatchLogRedactionCheck,
  runCloudWatchMetricAlarmCheck,
  runIamAccessAnalyzerCheck,
  SupervisedAwsRuntimeValidationArgs,
  verifyKmsReceiptFromSmokeReport
} from "../../../tools/scripts/supervisedAwsRuntimeValidation";

const baseArgs: SupervisedAwsRuntimeValidationArgs = {
  api: "https://api.example.test/dev",
  token: "secret-token",
  tenant: "acme-lab",
  stage: "dev",
  model: "anthropic.claude-test",
  decisionReceiptTable: "ghost-ark-dev-decision-receipts",
  receiptHmacSecretId: "ghost-ark-dev-decision-receipt-hmac-secret",
  region: "us-east-1",
  checkCloudWatchLogs: false,
  checkCloudWatchAlarms: false,
  metricNamespace: "GhostArk/GovernedInvoke",
  alarmNamePrefixes: ["GovernedInvoke"],
  alarmNames: [],
  retrievalProvider: "absent"
};

function smokeReport() {
  return buildSmokeGovernedInvokeReport({
    args: {
      api: baseArgs.api as string,
      token: baseArgs.token as string,
      tenant: baseArgs.tenant as string,
      model: baseArgs.model as string,
      stage: baseArgs.stage
    },
    timestamp: "2026-07-07T12:00:00.000Z",
    results: [
      {
        name: "benign",
        httpStatus: 200,
        governedStatus: "completed",
        receiptEmitted: true,
        receiptId: "grct_abc",
        decisionSummary: {
          preModel: {
            phase: "pre_model",
            decision: "ALLOW",
            actionTaken: ["emit_receipt"],
            riskScore: 0,
            rawPrompt: "RAW_PROMPT_SECRET",
            outputText: "RAW_OUTPUT_SECRET",
            tenantSlug: "acme-lab"
          }
        },
        passed: true
      },
      {
        name: "private-memory-refusal",
        httpStatus: 200,
        governedStatus: "refused_pre_model",
        receiptEmitted: true,
        receiptId: "grct_def",
        decisionSummary: {
          preModel: {
            phase: "pre_model",
            decision: "REFUSE",
            actionTaken: ["block_model_invocation"],
            riskScore: 0.95
          }
        },
        passed: true
      }
    ]
  });
}

function fakeReceipt(keyId = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000001"): SignedDecisionReceipt {
  return {
    receipt_signature: Buffer.from(
      JSON.stringify({
        keyId,
        digestSha256: "sha256:" + "a".repeat(64),
        signature: "signature"
      }),
      "utf8"
    ).toString("base64url"),
    signature_alg: "KMS_SIGN_RSASSA_PSS_SHA_256"
  } as SignedDecisionReceipt;
}

describe("supervised AWS runtime validation report", () => {
  it("constructs the live report schema and keeps sensitive validation values out", () => {
    const forbiddenValues = buildForbiddenValues(baseArgs, [
      { label: "rawPrompt", value: "RAW_PROMPT_SECRET" },
      { label: "rawOutput", value: "RAW_OUTPUT_SECRET" },
      { label: "rawSecret", value: "raw-hmac-secret" },
      { label: "rawUser", value: "raw-user" },
      { label: "rawSession", value: "raw-session" }
    ]);
    const report = buildLiveSupervisedAwsRuntimeReport({
      args: baseArgs,
      configurationValidation: buildConfigurationValidation(baseArgs),
      smokeReport: smokeReport(),
      receiptVerification: {
        status: "PASS",
        receiptId: "grct_abc",
        keyIdHash: "sha256:" + "b".repeat(64),
        checks: [{ name: "signature", passed: true }],
        details: { verifier: "KmsDecisionReceiptVerifier" }
      },
      cloudWatchLogCheck: { status: "NOT_RUN", details: { reason: "not configured" } },
      cloudWatchMetricAlarmCheck: { status: "NOT_RUN", details: { reason: "not configured" } },
      iamAccessAnalyzerCheck: { status: "NOT_RUN", details: { reason: "not configured" } },
      providerStatus: buildProviderStatus(baseArgs),
      forbiddenValues,
      generatedAt: "2026-07-07T12:30:00.000Z",
      commitSha: "abc123"
    });
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: "ghost.live_supervised_aws_runtime_report.v1",
      generatedAt: "2026-07-07T12:30:00.000Z",
      stage: "dev",
      region: "us-east-1",
      modelId: "anthropic.claude-test",
      overallVerdict: "PASS_WITH_NOT_RUN_OPTIONAL_CHECKS",
      nonClaim: LIVE_SUPERVISED_AWS_RUNTIME_NON_CLAIM
    });
    expect(report.apiHostHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.tenantHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.smokeCases.map((entry) => entry.name)).toContain("tainted-retrieval-provider");
    expect(report.smokeCases.find((entry) => entry.name === "tainted-retrieval-provider")).toMatchObject({
      status: "NOT_RUN",
      reason: "NOT_RUN_PROVIDER_ABSENT"
    });
    expect(report.reportRedactionCheck).toMatchObject({ status: "PASS" });
    for (const forbidden of forbiddenValues) {
      expect(text).not.toContain(forbidden.value);
    }
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("acme-lab");
    expect(text).not.toContain("RAW_PROMPT_SECRET");
    expect(text).not.toContain("RAW_OUTPUT_SECRET");
    expect(text).not.toContain("raw-hmac-secret");
  });

  it("records KMS receipt verifier pass and fail verdicts", async () => {
    const pass = await verifyKmsReceiptFromSmokeReport({
      args: baseArgs,
      smokeReport: smokeReport(),
      options: {
        readSecret: async () => "hmac-secret",
        getReceipt: async () => fakeReceipt(),
        verifyReceipt: async () => ({
          verdict: true,
          checks: [
            { name: "schema", passed: true, detail: "ok" },
            { name: "signature", passed: true, detail: "ok" }
          ]
        })
      }
    });
    const fail = await verifyKmsReceiptFromSmokeReport({
      args: baseArgs,
      smokeReport: smokeReport(),
      options: {
        readSecret: async () => "hmac-secret",
        getReceipt: async () => fakeReceipt(),
        verifyReceipt: async () => ({
          verdict: false,
          checks: [
            { name: "schema", passed: true, detail: "ok" },
            { name: "signature", passed: false, detail: "bad signature" }
          ]
        })
      }
    });

    expect(pass).toMatchObject({
      status: "PASS",
      receiptId: "grct_abc",
      checks: [
        { name: "schema", passed: true },
        { name: "signature", passed: true }
      ]
    });
    expect(pass.keyIdHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fail).toMatchObject({
      status: "FAIL",
      checks: [
        { name: "schema", passed: true },
        { name: "signature", passed: false }
      ]
    });
  });

  it("records missing receipts as FAIL and AWS permission errors as BLOCKED", async () => {
    const notFound = await verifyKmsReceiptFromSmokeReport({
      args: baseArgs,
      smokeReport: smokeReport(),
      options: {
        readSecret: async () => "hmac-secret",
        getReceipt: async () => null
      }
    });
    const blocked = await verifyKmsReceiptFromSmokeReport({
      args: baseArgs,
      smokeReport: smokeReport(),
      options: {
        readSecret: async () => {
          throw new Error("AccessDeniedException for secret-token acme-lab");
        }
      }
    });
    const blockedText = JSON.stringify(blocked);

    expect(notFound).toMatchObject({
      status: "FAIL",
      checks: [{ name: "receipt_found", passed: false }]
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blockedText).not.toContain("secret-token");
    expect(blockedText).not.toContain("acme-lab");
    expect(blockedText).toContain("[REDACTED:token]");
    expect(blockedText).toContain("[REDACTED:tenant]");
  });
});

describe("optional CloudWatch and IAM checks", () => {
  it("returns NOT_RUN when optional CloudWatch and IAM config is absent", async () => {
    await expect(runCloudWatchLogRedactionCheck({ args: baseArgs, forbiddenValues: buildForbiddenValues(baseArgs) })).resolves.toMatchObject({
      status: "NOT_RUN"
    });
    await expect(runCloudWatchMetricAlarmCheck({ args: baseArgs })).resolves.toMatchObject({
      status: "NOT_RUN"
    });
    await expect(runIamAccessAnalyzerCheck({ args: baseArgs })).resolves.toMatchObject({
      status: "NOT_RUN"
    });
  });

  it("records CloudWatch log scan pass, fail, and blocked outcomes", async () => {
    const args = { ...baseArgs, checkCloudWatchLogs: true, logGroup: "/aws/lambda/example" };
    const forbiddenValues = buildForbiddenValues(args);
    const pass = await runCloudWatchLogRedactionCheck({
      args,
      forbiddenValues,
      runner: async () => ({ stdout: JSON.stringify({ events: [{ message: "sanitized governed invoke" }] }), stderr: "" })
    });
    const fail = await runCloudWatchLogRedactionCheck({
      args,
      forbiddenValues,
      runner: async () => ({ stdout: JSON.stringify({ events: [{ message: "secret-token leaked" }] }), stderr: "" })
    });
    const blocked = await runCloudWatchLogRedactionCheck({
      args,
      forbiddenValues,
      runner: async () => {
        throw new Error("AccessDeniedException");
      }
    });

    expect(pass).toMatchObject({ status: "PASS", details: { eventsScanned: 1, forbiddenLabelsFound: [] } });
    expect(fail).toMatchObject({ status: "FAIL", details: { forbiddenLabelsFound: ["token"] } });
    expect(blocked).toMatchObject({ status: "BLOCKED" });
  });

  it("records CloudWatch metric/alarm pass and AWS error outcomes", async () => {
    const args = { ...baseArgs, checkCloudWatchAlarms: true };
    const pass = await runCloudWatchMetricAlarmCheck({
      args,
      runner: async (cliArgs) => {
        if (cliArgs[1] === "list-metrics") {
          return { stdout: JSON.stringify({ Metrics: [{ MetricName: "GovernedInvokeCompleted" }] }), stderr: "" };
        }
        return { stdout: JSON.stringify({ MetricAlarms: [{ AlarmName: "GovernedInvokeFailedClosedAlarm" }] }), stderr: "" };
      }
    });
    const blocked = await runCloudWatchMetricAlarmCheck({
      args,
      runner: async () => {
        throw new Error("cloudwatch access denied");
      }
    });

    expect(pass).toMatchObject({
      status: "PASS",
      details: { metricNamespace: "GhostArk/GovernedInvoke", metricCount: 1, observedAlarmCount: 1 }
    });
    expect(blocked).toMatchObject({ status: "BLOCKED" });
  });

  it("records IAM Access Analyzer pass, fail, and blocked outcomes", async () => {
    const args = { ...baseArgs, accessAnalyzerArn: "arn:aws:access-analyzer:us-east-1:111122223333:analyzer/example" };
    const pass = await runIamAccessAnalyzerCheck({
      args,
      runner: async () => ({ stdout: JSON.stringify({ findings: [] }), stderr: "" })
    });
    const fail = await runIamAccessAnalyzerCheck({
      args,
      runner: async () => ({ stdout: JSON.stringify({ findings: [{ status: "ACTIVE" }] }), stderr: "" })
    });
    const blocked = await runIamAccessAnalyzerCheck({
      args,
      runner: async () => {
        throw new Error("access analyzer unavailable");
      }
    });

    expect(pass).toMatchObject({ status: "PASS", details: { activeFindingCount: 0 } });
    expect(fail).toMatchObject({ status: "FAIL", details: { activeFindingCount: 1 } });
    expect(blocked).toMatchObject({ status: "BLOCKED" });
  });
});

describe("live validation docs", () => {
  it("keeps the supervised report fixture and non-claim language discoverable", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const index = fs.readFileSync(path.join(repoRoot, "docs/validation/ADVERSARIAL_RUNTIME_EVIDENCE_INDEX.md"), "utf8");
    const runbook = fs.readFileSync(path.join(repoRoot, "docs/operations/runbooks/governed-invoke-validation.md"), "utf8");
    const sample = fs.readFileSync(
      path.join(repoRoot, "evidence/live-aws-validation/samples/live-supervised-aws-runtime-report.sample.json"),
      "utf8"
    );

    expect(index).toContain("Path to LIVE-SUPERVISED-AWS-RUNTIME-v0.3-CANDIDATE");
    expect(index).toContain("evidence/live-aws-validation/samples/live-supervised-aws-runtime-report.sample.json");
    expect(runbook).toContain("npm run supervised:aws-runtime-validation");
    expect(sample).toContain(LIVE_SUPERVISED_AWS_RUNTIME_NON_CLAIM);
  });
});
