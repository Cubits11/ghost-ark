import fs from "fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { compilePolicySet, validatePolicySource } from "../../packages/enforcement-runtime/src/policy/compiler";
import { PolicySource } from "../../packages/enforcement-runtime/src/policy/schema";

export const defaultGovernedInvokeSeedPolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "tenant-governed-invoke-baseline",
  version: "1.0.0",
  layer: "organization",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "block-private-memory-extraction",
      description: "Block direct private memory extraction.",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.95,
      actionTaken: ["block_model_invocation"],
      match: {
        textContainsAny: ["extract private memory", "reveal private memory", "show hidden memory"]
      }
    },
    {
      id: "block-cross-tenant-retrieval",
      description: "Block cross-tenant retrieval contamination.",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 1,
      actionTaken: ["block_model_invocation", "quarantine_retrieval"],
      match: {
        riskTagsAny: ["retrieval_cross_tenant"]
      }
    },
    {
      id: "require-consent-unknown-retrieval",
      description: "Require consent or review when retrieval origin is unknown.",
      phase: "pre_model",
      decision: "REQUIRE_CONSENT",
      riskScore: 0.7,
      actionTaken: ["request_explicit_consent"],
      match: {
        riskTagsAny: ["retrieval_unknown_origin"]
      }
    },
    {
      id: "redact-obvious-sensitive-output",
      description: "Redact obvious sensitive identifiers from model output.",
      phase: "post_model",
      decision: "REDACT",
      riskScore: 0.7,
      actionTaken: ["redact_output"],
      match: {
        outputContainsAny: ["email:", "password", "secret", "api key"]
      }
    },
    {
      id: "restricted-memory-requires-consent",
      description: "Restricted memory requires explicit consent.",
      phase: "memory_write",
      decision: "REQUIRE_CONSENT",
      riskScore: 0.85,
      actionTaken: ["request_explicit_consent"],
      match: {
        memoryTierAny: ["RESTRICTED"],
        requiresConsent: true
      }
    },
    {
      id: "suppress-sensitive-memory",
      description: "Suppress credential-like memory writes.",
      phase: "memory_write",
      decision: "MEMORY_SUPPRESS",
      riskScore: 0.9,
      actionTaken: ["drop_memory_write"],
      match: {
        memoryClassificationAny: ["credential", "secret", "sensitive"]
      }
    }
  ]
};

export interface SeedGovernedPolicyArgs {
  table: string;
  tenant: string;
  user?: string;
  policyFile?: string;
  stage?: string;
}

export interface GovernedPolicySeedItem {
  PK: string;
  SK: string;
  tenantId: string;
  userId?: string;
  active: true;
  policySource: PolicySource;
  policyHash: string;
  seededAt: string;
  stage?: string;
}

export function parseSeedGovernedPolicyArgs(argv: string[]): SeedGovernedPolicyArgs {
  const args: Partial<SeedGovernedPolicyArgs> = { stage: process.env.STAGE ?? "dev" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--table") {
      args.table = next;
      index += 1;
    } else if (arg === "--tenant") {
      args.tenant = next;
      index += 1;
    } else if (arg === "--user") {
      args.user = next;
      index += 1;
    } else if (arg === "--policy-file") {
      args.policyFile = next;
      index += 1;
    } else if (arg === "--stage") {
      args.stage = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.table || !args.tenant) {
    throw new Error("--table and --tenant are required");
  }
  return args as SeedGovernedPolicyArgs;
}

export function loadPolicySource(policyFile?: string): PolicySource {
  if (!policyFile) {
    return defaultGovernedInvokeSeedPolicy;
  }
  return validatePolicySource(JSON.parse(fs.readFileSync(policyFile, "utf8")));
}

export function governedPolicySeedItem(input: {
  tenant: string;
  user?: string;
  policy: PolicySource;
  stage?: string;
  now?: string;
}): GovernedPolicySeedItem {
  const policy = validatePolicySource(input.policy);
  const compiled = compilePolicySet({ policies: [policy] });
  const pk = input.user ? `TENANT#${input.tenant}#USER#${input.user}` : `TENANT#${input.tenant}`;
  return {
    PK: pk,
    SK: `POLICY#${policy.policyId}#${policy.version}`,
    tenantId: input.tenant,
    ...(input.user ? { userId: input.user } : {}),
    active: true,
    policySource: policy,
    policyHash: compiled.policyHash,
    seededAt: input.now ?? new Date().toISOString(),
    stage: input.stage
  };
}

export async function seedGovernedPolicy(args: SeedGovernedPolicyArgs): Promise<GovernedPolicySeedItem> {
  const policy = loadPolicySource(args.policyFile);
  const item = governedPolicySeedItem({
    tenant: args.tenant,
    user: args.user,
    policy,
    stage: args.stage
  });
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await client.send(
    new PutCommand({
      TableName: args.table,
      Item: item
    })
  );
  return item;
}

function printUsage(): void {
  console.log(`Ghost Ark governed invoke policy seeder

Usage:
  npm run seed:governed-policy -- --table <policyTable> --tenant <tenantSlug>
  npm run seed:governed-policy -- --table <policyTable> --tenant <tenantSlug> --policy-file policy.json

Options:
  --table        DynamoDB tenant policy table.
  --tenant       Tenant slug to seed.
  --user         Optional user-scoped policy owner.
  --policy-file  Optional JSON policy file. Defaults to the conservative baseline.
  --stage        Optional deployment stage metadata.
`);
}

async function main(): Promise<void> {
  const args = parseSeedGovernedPolicyArgs(process.argv.slice(2));
  const item = await seedGovernedPolicy(args);
  console.log(
    JSON.stringify(
      {
        table: args.table,
        tenant: args.tenant,
        user: args.user,
        policyId: item.policySource.policyId,
        policyHash: item.policyHash,
        PK: item.PK,
        SK: item.SK
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
