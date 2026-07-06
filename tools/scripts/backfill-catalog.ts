#!/usr/bin/env node
import { AthenaClient, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { GlueClient, StartCrawlerCommand } from "@aws-sdk/client-glue";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const region = arg("region", process.env.AWS_REGION ?? "us-east-1");
  const crawlerName = arg("crawler");
  const database = arg("database");
  const table = arg("table");
  const workgroup = arg("workgroup");
  const outputLocation = arg("athena-output");
  await new GlueClient({ region }).send(new StartCrawlerCommand({ Name: crawlerName }));
  const response = await new AthenaClient({ region }).send(
    new StartQueryExecutionCommand({
      QueryString: `MSCK REPAIR TABLE ${database}.${table}`,
      WorkGroup: workgroup,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: { OutputLocation: outputLocation }
    })
  );
  console.log(JSON.stringify({ crawlerName, queryExecutionId: response.QueryExecutionId }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
