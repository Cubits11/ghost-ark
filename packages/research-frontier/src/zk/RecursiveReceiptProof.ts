export interface RecursiveProofNode {
  step: number;
  innerProofHash: string;
  accumulatedRoot: string;
}

export class RecursiveReceiptProofChain {
  private readonly steps: RecursiveProofNode[] = [];

  appendStep(step: number, innerProofHash: string, accumulatedRoot: string): void {
    this.steps.push({ step, innerProofHash, accumulatedRoot });
  }

  getChain(): readonly RecursiveProofNode[] {
    return this.steps;
  }
}
