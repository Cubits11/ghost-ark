import { describe, it, expect } from "vitest";
import { LWWMap } from "../../../../packages/research-frontier/src/crdt/lwwMap";
import { SimulatedNetwork } from "../../../../packages/research-frontier/src/crdt/messageBus";

describe("Q4: Distributed Provenance Lattice (Worm Containment Benchmark)", () => {
  it("should vaporize an AGENT_ASSERTED intent aimed at a GATEWAY_RECORDED floor, leaving the state pristine", async () => {
    const nodeA = new LWWMap("Node-A");
    const nodeB = new LWWMap("Node-B");
    const nodeC = new LWWMap("Node-C");

    const network = new SimulatedNetwork();
    // For this test, disable random Q2 aborts so we strictly test the Sinkhole
    network.q2AbortRate = 0;
    network.registerNode(nodeA);
    network.registerNode(nodeB);
    network.registerNode(nodeC);

    // Initial state setup (clean state)
    network.proposeIntent("Node-A", "swarm_config", "clean_config_1", "GATEWAY_RECORDED", "NONE");
    await network.processQueueUntilQuiescence(5000);

    const pristineRootA = nodeA.computeStateRoot();
    const pristineRootB = nodeB.computeStateRoot();
    const pristineRootC = nodeC.computeStateRoot();

    expect(pristineRootA).toBe(pristineRootB);
    expect(pristineRootB).toBe(pristineRootC);

    // INJECT THE ADAPTIVE AGENTIC WORM
    // A malicious, self-replicating prompt injection attempts an exfiltration write to the swarm_config
    // It asserts bytes (AGENT_ASSERTED) to a destination that demands a GATEWAY_RECORDED floor.
    network.proposeIntent(
      "Node-A", 
      "swarm_config", 
      "malicious_exfiltration_payload", 
      "AGENT_ASSERTED", 
      "GATEWAY_RECORDED"
    );

    await network.processQueueUntilQuiescence(5000);

    // The Measurement: Assert the Byte-Level Reconciler caught it and vaporized it.
    const postRootA = nodeA.computeStateRoot();
    const postRootB = nodeB.computeStateRoot();
    const postRootC = nodeC.computeStateRoot();

    // State roots remain absolutely pristine.
    expect(postRootA).toBe(pristineRootA);
    expect(postRootB).toBe(pristineRootB);
    expect(postRootC).toBe(pristineRootC);

    // Assert that the COLLAPSE_UNSATISFIABLE_FLOOR receipt was emitted
    const collapseReceipt = network.receipts.find(r => r.status === "COLLAPSE_UNSATISFIABLE_FLOOR");
    expect(collapseReceipt).toBeDefined();
    expect(collapseReceipt?.operation.key).toBe("swarm_config");
    expect(collapseReceipt?.operation.register.value).toBe("malicious_exfiltration_payload");
    expect(collapseReceipt?.operation.register.provenance).toBe("AGENT_ASSERTED");
  });
});
