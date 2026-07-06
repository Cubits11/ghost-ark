#!/usr/bin/env node
import { IAMClient, TagUserCommand } from "@aws-sdk/client-iam";
import { compileTenantNamespace } from "../../packages/policy-compiler/src/tenantNamespace";
import { compileTenantSandboxPolicy } from "../../packages/policy-compiler/src/iamPolicies";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const tenantSlug = arg("tenant");
  const stage = arg("stage", "dev");
  const region = arg("region", process.env.AWS_REGION ?? "us-east-1");
  const userName = process.argv.includes("--tag-user") ? arg("tag-user") : undefined;
  const namespace = compileTenantNamespace({
    stage,
    tenantSlug,
    rawBucket: arg("raw-bucket"),
    curatedBucket: arg("curated-bucket"),
    exportBucket: arg("export-bucket"),
    resultsBucket: arg("results-bucket"),
    region
  });
  const policy = compileTenantSandboxPolicy({
    stage,
    tenantSlug,
    rawBucket: arg("raw-bucket"),
    curatedBucket: arg("curated-bucket"),
    exportBucket: arg("export-bucket"),
    resultsBucket: arg("results-bucket"),
    region,
    accountId: arg("account-id"),
    allowedRegions: [region],
    tenantServiceRoleArn: arg("tenant-service-role-arn")
  });

  if (userName) {
    await new IAMClient({ region }).send(
      new TagUserCommand({
        UserName: userName,
        Tags: [{ Key: "slug", Value: namespace.tenantSlug }]
      })
    );
  }

  console.log(JSON.stringify({ namespace, policy }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
