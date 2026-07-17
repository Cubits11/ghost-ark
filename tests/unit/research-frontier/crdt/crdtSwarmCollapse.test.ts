import { describe, it, expect } from "vitest";
import { LWWMap } from "../../../../packages/research-frontier/src/crdt/lwwMap";
import { SimulatedNetwork } from "../../../../packages/research-frontier/src/crdt/messageBus";
import { verifyCrdtReceipt } from "../../../../packages/research-frontier/src/crdt/receipt";

describe("Q3: Distributed CRDT Swarm Collapse Benchmark", () => {
  it("should survive massive collisions, drop Q2 aborts, and deterministically converge across 3 nodes", async () => {
    const nodeA = new LWWMap("Node-A");
    const nodeB = new LWWMap("Node-B");
    const nodeC = new LWWMap("Node-C");

    const network = new SimulatedNetwork();
    network.q2AbortRate = 0.20; // 20% payload failure rate (EVALUATION_UNDECIDABLE)
    network.registerNode(nodeA);
    network.registerNode(nodeB);
    network.registerNode(nodeC);

    const AGENTS = 1000;
    
    // Blast the network concurrently
    const intents = Array.from({ length: AGENTS }).map(async (_, i) => {
      // Pick a random node for the agent to connect to
      const targetNodeId = ["Node-A", "Node-B", "Node-C"][i % 3];
      
      // Force heavy collisions: 50% write to a single heavily contested key
      const key = i % 2 === 0 ? "swarm_config" : `agent_data_${i}`;
      const value = `speculation_${i}`;
      
      network.proposeIntent(targetNodeId, key, value);
    });

    await Promise.all(intents);
    
    // Wait for the simulated CRDT broadcast queue to drain
    await network.processQueueUntilQuiescence(10000);

    const rootA = nodeA.computeStateRoot();
    const rootB = nodeB.computeStateRoot();
    const rootC = nodeC.computeStateRoot();

    // The Empirical Verdict: State convergence is perfectly achieved.
    expect(rootA).toBe(rootB);
    expect(rootB).toBe(rootC);
    
    // Validate that the receipts are properly structured and mathematically sound
    expect(network.receipts.length).toBeGreaterThan(0);
    const sampleReceipt = network.receipts[network.receipts.length - 1];
    expect(verifyCrdtReceipt(sampleReceipt)).toBe(true);
    
    // We expect some writes to be strictly DISCARDED due to Lamport clock/Node ID deterministic rules.
    const discarded = network.receipts.filter(r => r.status === "DISCARDED");
    expect(discarded.length).toBeGreaterThan(0);
  });
});
