import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SignedEpochCheckpoint, verifyMerkleInclusionProof } from "./checkpoint";

export interface ReceiptCheckpointRepository {
  put(checkpoint: SignedEpochCheckpoint): Promise<void>;
  get(epochId: string): Promise<SignedEpochCheckpoint | null>;
  listRecent?(limit?: number): Promise<SignedEpochCheckpoint[]>;
}

export interface DynamoDbReceiptCheckpointRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoDbReceiptCheckpointRepository implements ReceiptCheckpointRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoDbReceiptCheckpointRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(checkpoint: SignedEpochCheckpoint): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: checkpointItem(checkpoint),
        ConditionExpression: "attribute_not_exists(epochId)"
      })
    );
  }

  async get(epochId: string): Promise<SignedEpochCheckpoint | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { epochId },
        ConsistentRead: true
      })
    );
    return parseCheckpointItem(response.Item);
  }

  async listRecent(limit = 20): Promise<SignedEpochCheckpoint[]> {
    const response = await this.client.send(
      new ScanCommand({
        TableName: this.tableName
      })
    );
    return (response.Items ?? []).flatMap((item) => {
      const checkpoint = parseCheckpointItem(item);
      return checkpoint ? [checkpoint] : [];
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  }
}

export class InMemoryReceiptCheckpointRepository implements ReceiptCheckpointRepository {
  private readonly checkpoints = new Map<string, SignedEpochCheckpoint>();

  async put(checkpoint: SignedEpochCheckpoint): Promise<void> {
    if (this.checkpoints.has(checkpoint.epochId)) {
      throw new Error(`Checkpoint ${checkpoint.epochId} already exists`);
    }
    this.checkpoints.set(checkpoint.epochId, checkpoint);
  }

  async get(epochId: string): Promise<SignedEpochCheckpoint | null> {
    return this.checkpoints.get(epochId) ?? null;
  }

  async listRecent(limit = 20): Promise<SignedEpochCheckpoint[]> {
    return [...this.checkpoints.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}

export function assertCheckpointIncludesHead(input: {
  checkpoint: SignedEpochCheckpoint;
  proof: Parameters<typeof verifyMerkleInclusionProof>[0];
}): void {
  if (input.proof.root !== input.checkpoint.merkleRoot) {
    throw new Error("Checkpoint inclusion proof root does not match checkpoint merkleRoot");
  }
  if (!verifyMerkleInclusionProof(input.proof, input.checkpoint.merkleRoot)) {
    throw new Error("Checkpoint inclusion proof does not reconstruct the checkpoint merkleRoot");
  }
}

function checkpointItem(checkpoint: SignedEpochCheckpoint): Record<string, unknown> {
  return {
    checkpointNamespace: "global",
    epochId: checkpoint.epochId,
    createdAt: checkpoint.createdAt,
    merkleRoot: checkpoint.merkleRoot,
    leafCount: checkpoint.leafCount,
    signerKeyId: checkpoint.signerKeyId,
    checkpoint
  };
}

function parseCheckpointItem(item: Record<string, unknown> | undefined): SignedEpochCheckpoint | null {
  const checkpoint = item?.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return null;
  }
  return checkpoint as SignedEpochCheckpoint;
}
