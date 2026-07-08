#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import { IamPolicyDocument } from "../../packages/policy-compiler/src/iamPolicies";
import {
  buildTenantBoundaryModel,
  verifyNoTenantBoundaryCounterexample
} from "../../packages/policy-compiler/src/formal/counterexampleEngine";
import {
  TenantNamespace,
  TenantNamespaceInput,
  compileTenantNamespace
} from "../../packages/policy-compiler/src/tenantNamespace";

interface Args {
  policy?: string;
  tenant?: string;
  namespace?: string;
  out?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--policy") {
      args.policy = next;
      index += 1;
    } else if (arg === "--tenant") {
      args.tenant = next;
      index += 1;
    } else if (arg === "--namespace") {
      args.namespace = next;
      index += 1;
    } else if (arg === "--out") {
      args.out = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage(): void {
  console.log(`Ghost Ark tenant policy counterexample verifier

Usage:
  npm run policy:counterexamples -- --policy path/to/policy.json --tenant tenant-a --namespace path/to/namespace.json --out reports/policy-counterexamples.json

The verifier is bounded to the Ghost-Ark generated tenant sandbox subset and is not a complete AWS IAM verifier.
`);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isTenantNamespace(value: unknown): value is TenantNamespace {
  return Boolean(
    value &&
      typeof value === "object" &&
      "s3" in value &&
      "dynamodb" in value &&
      "tenantSlug" in value
  );
}

function loadNamespace(filePath: string): TenantNamespace {
  const value = readJson(filePath);
  if (isTenantNamespace(value)) {
    return value;
  }
  return compileTenantNamespace(value as TenantNamespaceInput);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const policyPath = required(args.policy, "--policy");
  const tenantSlug = required(args.tenant, "--tenant");
  const namespacePath = required(args.namespace, "--namespace");
  const outPath = required(args.out, "--out");

  const policy = readJson(policyPath) as IamPolicyDocument;
  const namespace = loadNamespace(namespacePath);
  const boundary = buildTenantBoundaryModel({ tenantSlug, namespace });
  const report = verifyNoTenantBoundaryCounterexample({ document: policy, boundary });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`VERDICT: ${report.verdict}`);
  console.log(`policyDigest: ${report.policyDigest}`);
  console.log(`boundaryDigest: ${report.boundaryDigest}`);
  if (report.counterexamples.length > 0) {
    console.log(`counterexamples: ${report.counterexamples.length}`);
  }
  for (const warning of report.warnings) {
    console.log(`warning: ${warning}`);
  }
  if (report.verdict === "FAIL") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
