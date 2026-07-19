import { computeMerkleRoot } from "../merkle";

export interface MerkleCheckpoint {
  epochId: string;
  leafCount: number;
  merkleRoot: string;
  timestamp: string;
}

export function buildMerkleCheckpoint(epochId: string, receiptDigests: string[]): MerkleCheckpoint {
  const root = computeMerkleRoot(receiptDigests);
  return {
    epochId,
    leafCount: receiptDigests.length,
    merkleRoot: root,
    timestamp: new Date().toISOString()
  };
}
