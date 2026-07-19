export interface ProvenanceNode {
  nodeId: string;
  nodeType: "evidence" | "receipt" | "checkpoint" | "claim";
  gcsUri?: string;
  sha256Hex: string;
  createdAt: string;
}

export interface ProvenanceEdge {
  fromNodeId: string;
  toNodeId: string;
  relationship: "derives_from" | "includes" | "signs" | "verifies";
}

export class CloudProvenanceRecorder {
  private readonly nodes = new Map<string, ProvenanceNode>();
  private readonly edges: ProvenanceEdge[] = [];

  addNode(node: ProvenanceNode): void {
    this.nodes.set(node.nodeId, node);
  }

  addEdge(edge: ProvenanceEdge): void {
    this.edges.push(edge);
  }

  getGraph(): { nodes: ProvenanceNode[]; edges: ProvenanceEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges]
    };
  }
}
