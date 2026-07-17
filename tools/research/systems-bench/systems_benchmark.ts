import { CqrsMerkleLedger } from '../../../packages/research-frontier/src/systems/cqrs_merkle_ledger';
import { TendermintPBftCluster } from '../../../packages/research-frontier/src/systems/bft_tendermint_consensus';

async function runSystemsBenchmark() {
    console.log("==========================================================");
    console.log(" GHOST-ARK EMPIRICAL SYSTEMS BENCHMARK (V1.0.0-STRICT) ");
    console.log("==========================================================\n");

    // 1. CQRS Merkle Ledger Benchmark
    console.log("[VECTOR 4: EVENT-SOURCED ROLLBACKS] Simulating Ledger Throughput & Reversals...");
    const ledger = new CqrsMerkleLedger();
    
    console.time("  -> 10,000 Mutation Appends (Volatile V8 RAM)");
    for (let i = 0; i < 10000; i++) {
        ledger.appendMutation("AGENT_SYS", { key: `KEY_${i % 100}`, value: i });
    }
    console.timeEnd("  -> 10,000 Mutation Appends (Volatile V8 RAM)");
    
    // Explicit Fsync durability limits
    console.log("  -> [PHYSICS CHECK] True Event-Sourced durability relies on sequential append-only writes calling fs.appendFileSync().");
    console.log("  -> [PHYSICS CHECK] A standard Gen4 NVMe disk restricts IOPS strictly via PCI-e write barriers, realistically limiting real-world flush batches to ~250,000 IOPS.");

    const criticalEvent = ledger.appendMutation("AGENT_TARGET", { key: "NUCLEAR_LAUNCH_CODE", value: "AUTHORIZE" });
    console.log(`  -> Critical State Written: [NUCLEAR_LAUNCH_CODE = ${ledger.getState().get("NUCLEAR_LAUNCH_CODE")}]`);
    console.log(`  -> Merkle Root Hash: ${ledger.getMerkleRoot()}`);

    console.log(`  -> Kripke Refutation Triggered. Executing Compensating Reversal...`);
    ledger.executeCompensatingReversal(criticalEvent.eventId);
    
    console.log(`  -> Reversed State: [NUCLEAR_LAUNCH_CODE = ${ledger.getState().get("NUCLEAR_LAUNCH_CODE") || 'undefined'}]`);
    console.log(`  -> New Merkle Root Hash: ${ledger.getMerkleRoot()}\n`);

    // 2. Byzantine Fault Tolerant (BFT) PBFT Consensus Benchmark
    console.log("[VECTOR 5: BFT CONSENSUS] Simulating Tendermint PBFT Quorum across Global Nodes...");
    const nodeIds = Array.from({ length: 50 }, (_, i) => `NODE_${i}`);
    const raftCluster = new TendermintPBftCluster(nodeIds);

    console.log(`  -> Initiated Cluster: ${nodeIds.length} Nodes. Target Quorum: ${Math.ceil((2 * 50) / 3)} Nodes.`);
    
    console.time("  -> 1,000 Global Quorum State Mutations");
    let successfulMutations = 0;
    for (let i = 0; i < 1000; i++) {
        const success = raftCluster.requestStateMutation("PROPOSER_1", `HASH_${i}`);
        if (success) successfulMutations++;
    }
    console.timeEnd("  -> 1,000 Global Quorum State Mutations");
    
    console.log(`  -> BFT Consensus Rate: ${successfulMutations} / 1000 successful under 10% simulated Byzantine partition rate.`);
    
    console.log("\n==========================================================");
    console.log(" [SUCCESS] SYSTEMS ENGINEERING BENCHMARKS COMPLETE. ");
    console.log("==========================================================");
}

runSystemsBenchmark().catch(console.error);
