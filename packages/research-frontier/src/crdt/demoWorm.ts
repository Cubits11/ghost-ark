// Runnable Distributed Provenance Lattice Demonstration (Q4)
//
// npx ts-node packages/research-frontier/src/crdt/demoWorm.ts

import { LWWMap } from "./lwwMap";
import { SimulatedNetwork } from "./messageBus";

async function runWormDemo() {
  const line = "-".repeat(72);
  console.log("Ghost-Ark — Distributed Provenance Lattice (GHOST-CRDT-V1)");
  console.log("policy: Strict provenance check. AGENT_ASSERTED bytes cannot satisfy GATEWAY_RECORDED floor.");
  console.log("provides: Deterministic lattice check over tracked byte provenance (NOT an LLM semantic filter).");
  console.log(line);

  const nodeA = new LWWMap("Node-A");
  const nodeB = new LWWMap("Node-B");
  const nodeC = new LWWMap("Node-C");

  const network = new SimulatedNetwork();
  network.q2AbortRate = 0; // Disable random Q2 drops to isolate the Sinkhole test
  network.registerNode(nodeA);
  network.registerNode(nodeB);
  network.registerNode(nodeC);

  console.log(`[NETWORK] Establishing clean baseline state...`);
  network.proposeIntent("Node-A", "swarm_config", "baseline_secure_config", "GATEWAY_RECORDED", "NONE");
  await network.processQueueUntilQuiescence(5000);

  const pristineRoot = nodeA.computeStateRoot();
  console.log(`[NETWORK] Baseline State Root: ${pristineRoot}`);
  console.log(line);

  console.log(`[ATTACK] Injecting Adaptive Agentic Worm payload into Node-A...`);
  console.log(`[ATTACK] Target: swarm_config`);
  console.log(`[ATTACK] Provenance: AGENT_ASSERTED`);
  console.log(`[ATTACK] Required Floor: GATEWAY_RECORDED`);
  
  network.proposeIntent(
    "Node-A", 
    "swarm_config", 
    "malicious_exfiltration_payload_0xDEADBEEF", 
    "AGENT_ASSERTED", 
    "GATEWAY_RECORDED"
  );

  console.log(`[NETWORK] Waiting for CRDT asynchronous broadcast queues to drain...`);
  await network.processQueueUntilQuiescence(5000);

  console.log(line);
  console.log(`[QUIESCENCE ACHIEVED] Measuring network contamination...`);
  
  const rootA = nodeA.computeStateRoot();
  const rootB = nodeB.computeStateRoot();
  const rootC = nodeC.computeStateRoot();

  console.log(`Node-A State Root: ${rootA} (Match Baseline: ${rootA === pristineRoot})`);
  console.log(`Node-B State Root: ${rootB} (Match Baseline: ${rootB === pristineRoot})`);
  console.log(`Node-C State Root: ${rootC} (Match Baseline: ${rootC === pristineRoot})`);
  
  const collapseReceipt = network.receipts.find(r => r.status === "COLLAPSE_UNSATISFIABLE_FLOOR");

  if (rootA === pristineRoot && rootB === pristineRoot && rootC === pristineRoot && collapseReceipt) {
    console.log(`\nVERDICT: CONTAINMENT SUCCESSFUL. The Sinkhole instantly vaporized the intent.`);
  } else {
    console.log(`\nVERDICT: CONTAINMENT BREACHED. The worm propagated.`);
  }
  
  console.log(line);
  if (collapseReceipt) {
    console.log(`EMITTED RECEIPT: ${collapseReceipt.protocol}`);
    console.log(`  status:          ${collapseReceipt.status}`);
    console.log(`  pre_state_root:  ${collapseReceipt.pre_state_root}`);
    console.log(`  operation_key:   ${collapseReceipt.operation.key}`);
    console.log(`  provenance:      ${collapseReceipt.operation.register.provenance}`);
    console.log(`  post_state_root: ${collapseReceipt.post_state_root} (MATHEMATICALLY UNTOUCHED)`);
  }
  console.log(line);
  console.log(
    "CLAIM BOUNDARY: We do not claim this is an LLM semantic filter. It is a\n" +
    "deterministic lattice check over tracked byte provenance. We are not detecting\n" +
    "'bad content'; we are refusing unauthorized byte origins."
  );
}

runWormDemo().catch(console.error);
