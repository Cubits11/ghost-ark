export interface GraphNode {
  id: string;
  kind: string;
}

export class CloudReceiptGraph {
  private readonly adjacency = new Map<string, Set<string>>();

  addEdge(fromId: string, toId: string): void {
    if (!this.adjacency.has(fromId)) {
      this.adjacency.set(fromId, new Set());
    }
    this.adjacency.get(fromId)!.add(toId);
  }

  getReachable(startId: string): string[] {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = this.adjacency.get(curr);
      if (neighbors) {
        for (const next of neighbors) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
    }

    return Array.from(visited);
  }
}
