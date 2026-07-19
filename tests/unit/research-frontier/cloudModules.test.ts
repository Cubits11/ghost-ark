import { describe, it, expect } from "vitest";
import { checkEvidenceConsistency } from "../../../packages/research-frontier/src/cloud/EvidenceConsistency";
import { CloudWitnessSet } from "../../../packages/research-frontier/src/cloud/CloudWitnesses";
import { buildMerkleCheckpoint } from "../../../packages/research-frontier/src/cloud/MerkleCheckpointPublisher";
import { CloudReceiptGraph } from "../../../packages/research-frontier/src/cloud/CloudReceiptGraph";
import { IncrementalMerkleAccumulator } from "../../../packages/research-frontier/src/zk/IncrementalMerkleAccumulator";
import { CRDTReceiptIndex } from "../../../packages/research-frontier/src/distributed/CRDTReceiptIndex";
import { verifyPublicationInvariants } from "../../../packages/research-frontier/src/formal/CloudInvariantChecker";

describe("Research Frontier: Cloud & Advanced PhD Modules", () => {
  it("verifies evidence consistency helper", () => {
    const res = checkEvidenceConsistency({ e1: "hash1" }, { e1: "hash1" });
    expect(res.consistent).toBe(true);
  });

  it("checks witness quorum", () => {
    const set = new CloudWitnessSet();
    set.addWitnessSignature({ witnessId: "w1", signature: "sig1", timestamp: "now" });
    set.addWitnessSignature({ witnessId: "w2", signature: "sig2", timestamp: "now" });
    expect(set.hasQuorum(2)).toBe(true);
  });

  it("computes merkle checkpoint root", () => {
    const cp = buildMerkleCheckpoint("epoch-1", ["hash1", "hash2"]);
    expect(cp.merkleRoot).toBeDefined();
  });

  it("traverses cloud receipt graph reachability", () => {
    const graph = new CloudReceiptGraph();
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    expect(graph.getReachable("A")).toEqual(["A", "B", "C"]);
  });

  it("computes incremental merkle accumulator root", () => {
    const acc = new IncrementalMerkleAccumulator();
    acc.insertLeaf("leaf1");
    acc.insertLeaf("leaf2");
    expect(acc.getRoot()).toHaveLength(64);
  });

  it("merges CRDT receipt index state", () => {
    const c1 = new CRDTReceiptIndex();
    c1.addEntry({ receiptId: "r1", timestamp: "2026-07-19T00:00:00Z", tenantSlug: "t1" });

    const c2 = new CRDTReceiptIndex();
    c2.addEntry({ receiptId: "r2", timestamp: "2026-07-19T01:00:00Z", tenantSlug: "t1" });

    c1.merge(c2);
    expect(c1.getEntries()).toHaveLength(2);
  });

  it("verifies cloud publication invariant checker", () => {
    const res = verifyPublicationInvariants({
      storageReceiptIds: ["r1", "r2"],
      bigQueryReceiptIds: ["r1"]
    });
    expect(res.valid).toBe(true);
  });
});
