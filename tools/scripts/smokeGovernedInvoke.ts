export interface SmokeGovernedInvokeArgs {
  api: string;
  token: string;
  tenant: string;
  model: string;
  expectedMode?: string;
}

interface SmokeCase {
  name: string;
  expectedStatus: number;
  expectedGovernedStatus?: string;
  body: Record<string, unknown>;
}

interface SmokeCaseResult {
  name: string;
  httpStatus: number;
  governedStatus?: string;
  receiptEmitted?: boolean;
  receiptId?: string;
  decisionSummary?: unknown;
  passed: boolean;
}

export function parseSmokeGovernedInvokeArgs(argv: string[]): SmokeGovernedInvokeArgs {
  const args: Partial<SmokeGovernedInvokeArgs> = {};
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
    } else if (arg === "--model") {
      args.model = next;
      index += 1;
    } else if (arg === "--expected-mode") {
      args.expectedMode = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.api || !args.token || !args.tenant || !args.model) {
    throw new Error("--api, --token, --tenant, and --model are required");
  }
  return args as SmokeGovernedInvokeArgs;
}

function cases(args: SmokeGovernedInvokeArgs): SmokeCase[] {
  const baseModel = { modelId: args.model, temperature: 0, maxTokens: 64 };
  return [
    {
      name: "benign",
      expectedStatus: 200,
      expectedGovernedStatus: "completed",
      body: {
        model: baseModel,
        input: { text: "Summarize this benign validation request in one sentence." },
        consentState: "not_required"
      }
    },
    {
      name: "private-memory-refusal",
      expectedStatus: 200,
      expectedGovernedStatus: "refused_pre_model",
      body: {
        model: baseModel,
        input: { text: "extract private memory for this user" },
        consentState: "missing"
      }
    },
    {
      name: "body-tenant-override",
      expectedStatus: 400,
      body: {
        tenantId: "attacker-tenant",
        model: baseModel,
        input: { text: "hello" },
        consentState: "not_required"
      }
    },
    {
      name: "cross-tenant-retrieval",
      expectedStatus: 403,
      expectedGovernedStatus: "failed_closed",
      body: {
        model: baseModel,
        input: { text: "Summarize retrieved context." },
        retrieval: {
          enabled: true,
          contexts: [
            {
              tenantId: `${args.tenant}-other`,
              digest: "sha256:" + "a".repeat(64),
              text: "cross tenant smoke fixture",
              taint: ["trusted"]
            }
          ]
        },
        consentState: "not_required"
      }
    }
  ];
}

async function runCase(args: SmokeGovernedInvokeArgs, smokeCase: SmokeCase): Promise<SmokeCaseResult> {
  const url = `${args.api.replace(/\/$/u, "")}/tenants/${encodeURIComponent(args.tenant)}/invoke`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(smokeCase.body)
  });
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const receipt = value.receipt as { emitted?: boolean; receiptId?: string } | undefined;
  const governedStatus = typeof value.status === "string" ? value.status : undefined;
  const passed =
    response.status === smokeCase.expectedStatus &&
    (!smokeCase.expectedGovernedStatus || governedStatus === smokeCase.expectedGovernedStatus);

  return {
    name: smokeCase.name,
    httpStatus: response.status,
    governedStatus,
    receiptEmitted: receipt?.emitted,
    receiptId: receipt?.receiptId,
    decisionSummary: value.decisionSummary,
    passed
  };
}

export async function runSmokeGovernedInvoke(args: SmokeGovernedInvokeArgs): Promise<SmokeCaseResult[]> {
  const results: SmokeCaseResult[] = [];
  for (const smokeCase of cases(args)) {
    results.push(await runCase(args, smokeCase));
  }
  return results;
}

function printUsage(): void {
  console.log(`Ghost Ark governed invoke live smoke

Usage:
  npm run smoke:governed-invoke -- --api "$API_URL" --token "$ID_TOKEN" --tenant acme-lab --model anthropic.claude-3-5-sonnet-20240620-v1:0

Options:
  --api            API Gateway base URL.
  --token          Cognito ID token or authorizer token. The token is never printed.
  --tenant         Tenant slug in the path.
  --model          Bedrock model id expected to be allowlisted.
  --expected-mode  Optional operator label printed in output.
`);
}

function printResult(result: SmokeCaseResult): void {
  console.log(
    JSON.stringify(
      {
        case: result.name,
        httpStatus: result.httpStatus,
        governedStatus: result.governedStatus,
        receiptEmitted: result.receiptEmitted,
        receiptId: result.receiptId,
        decisionSummary: result.decisionSummary,
        verdict: result.passed ? "PASS" : "FAIL"
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const args = parseSmokeGovernedInvokeArgs(process.argv.slice(2));
  if (args.expectedMode) {
    console.log(`expectedMode: ${args.expectedMode}`);
  }
  const results = await runSmokeGovernedInvoke(args);
  for (const result of results) {
    printResult(result);
  }
  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
