// Simulated Multi-Node Asynchronous Transport Layer
//
// CLAIM BOUNDARY: This is a localized testing harness for CRDT convergence under adverse
// network conditions (latency, out-of-order delivery, random Q2 aborts).
// It does NOT claim to be a production TCP/UDP replacement or Byzantine Fault Tolerant protocol.

import { LWWRegister, LWWMap, Provenance } from "./lwwMap";
import { buildCrdtReceipt, CRDTReceipt } from "./receipt";

export interface NetworkMessage {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly key: string;
  readonly register: LWWRegister;
}

export type ProvenanceFloor = "GATEWAY_RECORDED" | "AGENT_ASSERTED" | "NONE";

export class SimulatedNetwork {
  private readonly nodes = new Map<string, LWWMap>();
  private readonly inFlightMessages: { msg: NetworkMessage; deliverAt: number }[] = [];
  public readonly receipts: CRDTReceipt[] = [];
  
  // Simulation parameters
  public latencyMinMs = 5;
  public latencyMaxMs = 20;
  // Percentage (0.0 to 1.0) representing agent payloads aborted by Q2 (EVALUATION_UNDECIDABLE)
  public q2AbortRate = 0.20;

  public registerNode(node: LWWMap) {
    this.nodes.set(node.nodeId, node);
  }

  // An agent proposes a write intent to a local node
  public proposeIntent(nodeId: string, key: string, value: string, provenance: Provenance = "AGENT_ASSERTED", requiredFloor: ProvenanceFloor = "NONE") {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // The Sinkhole (Byte-Level Reconciler)
    // If the destination demands a GATEWAY_RECORDED floor, but the byte-level reconciler detects AGENT_ASSERTED bytes
    if (requiredFloor === "GATEWAY_RECORDED" && provenance === "AGENT_ASSERTED") {
      const register = node.createWriteIntent(key, value, provenance);
      const preRoot = node.computeStateRoot();
      // Vaporize the intent instantly.
      this.receipts.push(buildCrdtReceipt(
        "COLLAPSE_UNSATISFIABLE_FLOOR",
        preRoot,
        key,
        register,
        preRoot // state is mathematically untouched
      ));
      return;
    }

    // The Q1/Q2 Gauntlet: Inject intentional EVALUATION_UNDECIDABLE aborts
    if (Math.random() < this.q2AbortRate) {
      // Aborted by Q2; intent is dropped entirely.
      return;
    }

    // Apply locally
    const register = node.createWriteIntent(key, value, provenance);
    const preRoot = node.computeStateRoot();
    const merged = node.apply(key, register);
    const postRoot = node.computeStateRoot();
    
    this.receipts.push(buildCrdtReceipt(
      merged ? "MERGED" : "DISCARDED",
      preRoot,
      key,
      register,
      postRoot
    ));

    // Broadcast delta to all other nodes
    for (const targetId of this.nodes.keys()) {
      if (targetId === nodeId) continue;
      
      const latency = this.latencyMinMs + Math.random() * (this.latencyMaxMs - this.latencyMinMs);
      this.inFlightMessages.push({
        msg: { fromNodeId: nodeId, toNodeId: targetId, key, register },
        deliverAt: Date.now() + latency,
      });
    }
  }

  public async processQueueUntilQuiescence(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (this.inFlightMessages.length > 0) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error("Network quiescence timeout");
      }
      
      const now = Date.now();
      const readyIdx = this.inFlightMessages.findIndex(m => m.deliverAt <= now);
      
      if (readyIdx !== -1) {
        const { msg } = this.inFlightMessages.splice(readyIdx, 1)[0];
        const targetNode = this.nodes.get(msg.toNodeId)!;
        
        const preRoot = targetNode.computeStateRoot();
        const merged = targetNode.apply(msg.key, msg.register);
        const postRoot = targetNode.computeStateRoot();
        
        this.receipts.push(buildCrdtReceipt(
          merged ? "MERGED" : "DISCARDED",
          preRoot,
          msg.key,
          msg.register,
          postRoot
        ));
      } else {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
  }
}
