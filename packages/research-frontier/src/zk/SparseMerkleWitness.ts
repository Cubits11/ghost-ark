export interface SparseWitnessProof {
  index: number;
  leafHash: string;
  siblings: string[];
}

export class SparseMerkleWitnessBuilder {
  buildWitness(index: number, leafHash: string, siblings: string[]): SparseWitnessProof {
    return { index, leafHash, siblings };
  }
}
