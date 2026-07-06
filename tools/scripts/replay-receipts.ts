#!/usr/bin/env node
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const stateMachineArn = arg("state-machine-arn", process.env.REPLAY_STATE_MACHINE_ARN);
  const tenantSlug = arg("tenant");
  const receiptIds = arg("receipts").split(",").map((receipt) => receipt.trim()).filter(Boolean);
  const replayReason = arg("reason", "operator-requested-replay");
  const notificationTopicArn = arg("notification-topic-arn", process.env.NOTIFICATION_TOPIC_ARN);
  const replayFunctionArn = arg("replay-function-arn", process.env.REPLAY_FUNCTION_ARN);
  const response = await new SFNClient({}).send(
    new StartExecutionCommand({
      stateMachineArn,
      name: `replay-${tenantSlug}-${Date.now()}`,
      input: JSON.stringify({ tenantSlug, receiptIds, replayReason, notificationTopicArn, replayFunctionArn })
    })
  );
  console.log(JSON.stringify(response, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
