import { createHash } from "crypto";

export class IncrementalMerkleAccumulator {
  private readonly leaves: string[] = [];

  insertLeaf(leafHash: string): number {
    this.leaves.push(leafHash);
    return this.leaves.length - 1;
  }

  getRoot(): string {
    if (this.leaves.length === 0) return "0000000000000000000000000000000000000000000000000000000000000000";
    let level = [...this.leaves];

    while (level.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        const combined = createHash("sha256").update(left + right).digest("hex");
        nextLevel.push(combined);
      }
      level = nextLevel;
    }

    return level[0];
  }
}
