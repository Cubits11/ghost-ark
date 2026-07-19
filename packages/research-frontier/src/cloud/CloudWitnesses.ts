export interface CloudWitnessSignature {
  witnessId: string;
  signature: string;
  timestamp: string;
}

export class CloudWitnessSet {
  private readonly witnesses = new Map<string, CloudWitnessSignature>();

  addWitnessSignature(sig: CloudWitnessSignature): void {
    this.witnesses.set(sig.witnessId, sig);
  }

  hasQuorum(requiredQuorum = 2): boolean {
    return this.witnesses.size >= requiredQuorum;
  }
}
