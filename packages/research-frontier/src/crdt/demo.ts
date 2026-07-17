// Runnable Distributed CRDT Swarm Collapse Demonstration (Q3)
//
// npx ts-node packages/research-frontier/src/crdt/demo.ts

import { LWWMap } from "./lwwMap";
import { SimulatedNetwork } from "./messageBus";

async function runDemo() {
  const line = "-".repeat(72);
  console.log("Ghost-Ark — Distributed CRDT Swarm Recovery (GHOST-CRDT-V1)");
  console.log("policy: LWW-Map (CvRDT) with monotonic Lamport clocks and Node ID tie-breakers.");
  console.log("provides: EVENTUAL CONSISTENCY (Not a Paxos/Raft strong consistency replacement)");
  console.log(line);

  const nodeA = new LWWMap("Node-A");
  const nodeB = new LWWMap("Node-B");
  const nodeC = new LWWMap("Node-C");

  const network = new SimulatedNetwork();
  network.q2AbortRate = 0.20; // 20% simulated abort rate
  network.registerNode(nodeA);
  network.registerNode(nodeB);
  network.registerNode(nodeC);

  const AGENTS = 1000;
  console.log(`[NETWORK] Blasting 3-Node Swarm with ${AGENTS} concurrent agent intents...`);
  console.log(`[NETWORK] Forcing 50% collisions on the 'swarm_config' key.`);
  console.log(`[NETWORK] Simulating random Q2 EVALUATION_UNDECIDABLE aborts (20% drop rate)...`);

  const startTime = Date.now();

  for (let i = 0; i < AGENTS; i++) {
    const targetNodeId = ["Node-A", "Node-B", "Node-C"][i % 3];
    const key = i % 2 === 0 ? "swarm_config" : `agent_data_${i}`;
    const value = `speculation_${i}`;
    network.proposeIntent(targetNodeId, key, value);
  }

  console.log(`[NETWORK] Waiting for CRDT asynchronous broadcast queues to drain...`);
  await network.processQueueUntilQuiescence(10000);

  const elapsed = Date.now() - startTime;
  console.log(line);
  console.log(`[QUIESCENCE ACHIEVED] Elapsed: ${elapsed}ms`);
  
  const rootA = nodeA.computeStateRoot();
  const rootB = nodeB.computeStateRoot();
  const rootC = nodeC.computeStateRoot();

  console.log(`Node-A State Root: ${rootA}`);
  console.log(`Node-B State Root: ${rootB}`);
  console.log(`Node-C State Root: ${rootC}`);
  
  if (rootA === rootB && rootB === rootC) {
    console.log(`\nVERDICT: ABSOLUTE CONVERGENCE. The LWW-Map completely mitigated the swarm collapse.`);
  } else {
    console.log(`\nVERDICT: DIVERGENCE DETECTED. The CRDT failed.`);
  }

  const merged = network.receipts.filter(r => r.status === "MERGED").length;
  const discarded = network.receipts.filter(r => r.status === "DISCARDED").length;
  
  console.log(line);
  console.log(`GHOST-CRDT-V1 Receipts Emitted: ${network.receipts.length}`);
  console.log(`  MERGED:    ${merged}`);
  console.log(`  DISCARDED: ${discarded} (Conflict resolution drops applied gracefully)`);
  console.log(line);
  console.log(
    "CLAIM BOUNDARY: We explicitly sacrifice serializable isolation on concurrent\n" +
    "colliding keys to physically bypass the starvation trap. We trade a phantom\n" +
    "anomaly for resilient liveness. This is exactly how a distributed swarm survives\n" +
    "its own collapse rate."
  );
}

runDemo().catch(console.error);
