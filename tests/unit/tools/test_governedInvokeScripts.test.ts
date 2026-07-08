import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseSeedGovernedPolicyArgs, governedPolicySeedItem, defaultGovernedInvokeSeedPolicy } from "../../../tools/scripts/seedGovernedPolicy";
import {
  buildSmokeGovernedInvokeReport,
  parseSmokeGovernedInvokeArgs,
  writeSmokeGovernedInvokeReport
} from "../../../tools/scripts/smokeGovernedInvoke";

describe("governed invoke scripts", () => {
  it("parses seed policy arguments", () => {
    expect(parseSeedGovernedPolicyArgs(["--table", "policies", "--tenant", "acme-lab", "--stage", "dev"])).toMatchObject({
      table: "policies",
      tenant: "acme-lab",
      stage: "dev"
    });
  });

  it("throws when seed policy required arguments are missing", () => {
    expect(() => parseSeedGovernedPolicyArgs(["--tenant", "acme-lab"])).toThrow(/--table/u);
  });

  it("builds a conservative active policy item", () => {
    const item = governedPolicySeedItem({
      tenant: "acme-lab",
      policy: defaultGovernedInvokeSeedPolicy,
      now: "2026-07-07T12:00:00.000Z"
    });

    expect(item.PK).toBe("TENANT#acme-lab");
    expect(item.active).toBe(true);
    expect(item.policySource.rules.map((rule) => rule.id)).toContain("block-cross-tenant-retrieval");
    expect(item.policyHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("parses smoke invoke arguments without exposing token values", () => {
    const args = parseSmokeGovernedInvokeArgs([
      "--api",
      "https://api.example.test",
      "--token",
      "secret-token",
      "--tenant",
      "acme-lab",
      "--model",
      "anthropic.claude-test",
      "--stage",
      "dev",
      "--json-report",
      "artifacts/smoke.json"
    ]);

    expect(args).toEqual({
      api: "https://api.example.test",
      token: "secret-token",
      tenant: "acme-lab",
      model: "anthropic.claude-test",
      stage: "dev",
      jsonReport: "artifacts/smoke.json"
    });
  });

  it("builds a sanitized smoke report with receipt ids and decision phase summaries", () => {
    const report = buildSmokeGovernedInvokeReport({
      args: {
        api: "https://api.example.test/dev",
        token: "secret-token",
        tenant: "acme-lab",
        model: "anthropic.claude-test",
        stage: "dev"
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
              userId: "raw-user",
              sessionId: "raw-session"
            }
          },
          passed: true
        }
      ]
    });
    const text = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: "ghost.governed_invoke.smoke_report.v1",
      timestamp: "2026-07-07T12:00:00.000Z",
      stage: "dev",
      modelId: "anthropic.claude-test",
      passed: true
    });
    expect(report.apiHostHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.tenantHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.cases[0]).toMatchObject({
      name: "benign",
      httpStatus: 200,
      governedStatus: "completed",
      receiptEmitted: true,
      receiptId: "grct_abc",
      decisionPhases: [{ name: "preModel", phase: "pre_model", decision: "ALLOW", actionTaken: ["emit_receipt"], riskScore: 0 }]
    });
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("RAW_PROMPT_SECRET");
    expect(text).not.toContain("RAW_OUTPUT_SECRET");
    expect(text).not.toContain("acme-lab");
    expect(text).not.toContain("raw-user");
    expect(text).not.toContain("raw-session");
  });

  it("writes the sanitized smoke report artifact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghost-ark-smoke-"));
    const reportPath = path.join(dir, "report.json");
    const report = buildSmokeGovernedInvokeReport({
      args: {
        api: "https://api.example.test",
        token: "secret-token",
        tenant: "acme-lab",
        model: "anthropic.claude-test"
      },
      results: [],
      timestamp: "2026-07-07T12:00:00.000Z"
    });

    writeSmokeGovernedInvokeReport(reportPath, report);

    expect(JSON.parse(fs.readFileSync(reportPath, "utf8"))).toMatchObject({
      schemaVersion: "ghost.governed_invoke.smoke_report.v1",
      cases: []
    });
  });
});
