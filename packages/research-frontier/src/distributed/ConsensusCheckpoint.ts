export interface Vote {
  nodeId: string;
  epochId: string;
  merkleRoot: string;
  signature: string;
}

export class ConsensusCheckpointValidator {
  private readonly votes: Vote[] = [];

  castVote(vote: Vote): void {
    this.votes.push(vote);
  }

  isConsensusReached(threshold = 3): boolean {
    const rootCounts = new Map<string, number>();
    for (const v of this.votes) {
      const count = (rootCounts.get(v.merkleRoot) || 0) + 1;
      rootCounts.set(v.merkleRoot, count);
      if (count >= threshold) return true;
    }
    return false;
  }
}
