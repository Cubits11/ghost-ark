import { createSignedEpochCheckpoint } from "../../packages/enforcement-runtime/src/receipts/checkpoint";
import { DynamoDbReceiptCheckpointRepository } from "../../packages/enforcement-runtime/src/receipts/checkpointRepository";
import { KmsDecisionReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { DynamoDbDecisionReceiptRepository } from "../../packages/enforcement-runtime/src/receipts/repository";

interface CliArgs {
  epochId?: string;
  createdAt?: string;
  receiptTable?: string;
  checkpointTable?: string;
  signingKeyId?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--epoch-id") {
      args.epochId = next;
      index += 1;
    } else if (arg === "--created-at") {
      args.createdAt = next;
      index += 1;
    } else if (arg === "--receipt-table") {
      args.receiptTable = next;
      index += 1;
    } else if (arg === "--checkpoint-table") {
      args.checkpointTable = next;
      index += 1;
    } else if (arg === "--signing-key-id") {
      args.signingKeyId = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required ${name}`);
  }
  return value;
}

function defaultEpochId(createdAt: string): string {
  return `epoch-${createdAt.slice(0, 13)}`;
}

function printUsage(): void {
  console.log(`Ghost Ark receipt checkpoint engine

Usage:
  npm run receipt:checkpoint -- --receipt-table <table> --checkpoint-table <table> --signing-key-id <kmsKeyId>

Options:
  --epoch-id          Optional checkpoint epoch id. Defaults to epoch-YYYY-MM-DDTHH.
  --created-at        Optional checkpoint creation timestamp. Defaults to now.
  --receipt-table     Decision receipt DynamoDB table.
  --checkpoint-table  Receipt checkpoint DynamoDB table.
  --signing-key-id    Dedicated epoch/checkpoint KMS signing key id.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const createdAt = args.createdAt ?? new Date().toISOString();
  const checkpoint = await createSignedEpochCheckpoint({
    epochId: args.epochId ?? defaultEpochId(createdAt),
    createdAt,
    receiptRepository: new DynamoDbDecisionReceiptRepository({
      tableName: required(args.receiptTable ?? process.env.GHOST_ARK_DECISION_RECEIPT_TABLE, "decision receipt table")
    }),
    checkpointRepository: new DynamoDbReceiptCheckpointRepository({
      tableName: required(args.checkpointTable ?? process.env.GHOST_ARK_RECEIPT_CHECKPOINT_TABLE, "receipt checkpoint table")
    }),
    signer: new KmsDecisionReceiptSigner({
      keyId: required(args.signingKeyId ?? process.env.GHOST_ARK_CHECKPOINT_SIGNING_KEY_ID, "checkpoint signing key id")
    })
  });
  console.log(JSON.stringify(checkpoint, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
