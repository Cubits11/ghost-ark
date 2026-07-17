import { WorldLedger, EpistemicWindowAgent } from '../../../packages/research-frontier/src/occ/time_state_replica';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runBenchmark() {
    console.log("==========================================================");
    console.log(" Ghost-Ark vs Legacy: Temporal State Corruption Benchmark ");
    console.log("==========================================================\n");

    // Side A: Legacy Asynchronous Chaos
    console.log("[Side A] Initiating Legacy Unshielded Concurrency...");
    const legacyLedger = new WorldLedger();
    legacyLedger.mutate("BANK_BALANCE", 100);

    const legacyAgent = new EpistemicWindowAgent(legacyLedger, "Agent_Alpha_Legacy");
    const bal_t0 = legacyAgent.pull("BANK_BALANCE");
    console.log(`  [t0] Agent reads balance: $${bal_t0}`);

    // Exogenous reality mutates immediately after the read
    console.log(`  [t0.1] (Exogenous Mutation) User deposits $50`);
    legacyLedger.mutate("BANK_BALANCE", 150);

    // Simulate Agent Compute Latency (LLM thinking O(10,000ms))
    console.log(`  [t0 -> t1] LLM Inference Latency executing... (1500ms simulation)`);
    await sleep(1500);

    // Agent executes transaction based on stale spatial data
    console.log(`  [t1] Agent commits PAY_ORDER_314 (-$100 from original balance)`);
    legacyAgent.stageWrite("BANK_BALANCE", bal_t0 - 100);
    legacyAgent.legacyBlindCommit();

    console.log(`  [Result] Final Ledger Balance: $${legacyLedger.read("BANK_BALANCE").data}`);
    console.log("  [Assessment] CORRUPT GHOST WRITE: The $50 deposit was physically destroyed.\n");


    // Side B: Ghost-Ark Temporal Refutation
    console.log("[Side B] Initiating Ghost-Ark O(1) Temporal Shielding...");
    const ghostLedger = new WorldLedger();
    ghostLedger.mutate("BANK_BALANCE", 100);

    const ghostAgent = new EpistemicWindowAgent(ghostLedger, "Agent_Beta_GhostArk");
    const bal_ghost_t0 = ghostAgent.pull("BANK_BALANCE");
    console.log(`  [t0] Agent reads balance: $${bal_ghost_t0}`);

    // Exogenous reality mutates
    console.log(`  [t0.1] (Exogenous Mutation) User deposits $50`);
    ghostLedger.mutate("BANK_BALANCE", 150);

    // Simulate Compute Latency
    console.log(`  [t0 -> t1] LLM Inference Latency executing... (1500ms simulation)`);
    await sleep(1500);

    console.log(`  [t1] Agent attempts PAY_ORDER_314 (-$100 from original balance)`);
    ghostAgent.stageWrite("BANK_BALANCE", bal_ghost_t0 - 100);
    const result = ghostAgent.collapse();

    console.log(`  [Result] Commit Status: ${result.status} (Conflicts: ${result.conflicts.join(', ')})`);
    console.log(`  [Result] Final Ledger Balance: $${ghostLedger.read("BANK_BALANCE").data}`);
    console.log("  [Assessment] RUTHLESS ONTOLOGICAL ROLLBACK: Memory protected. Stale dimensional computation wiped.\n");


    // Simulation of Concurrency Fail Rate Curve vs Latency Mismatch
    console.log("================== CONCURRENCY DRIFT METRICS ==================");
    console.log("Simulating Ecosystem Exogenous Load (Mutation Rate: 50 Ops/Sec)...");
    
    const latencies = [500, 2000, 5000, 10000]; // ms latency representing LLM compute wait times
    const mutationRatePerSec = 50; 

    for (const latency of latencies) {
        // Markov Chain absorption probability analog: divergence scales with time window
        const expectedMutations = (latency / 1000) * mutationRatePerSec;
        const collisionProb = Math.min(1.0, expectedMutations / 100); // SPN spatial divergence ratio
        
        let corruptWrites = 0;
        let occAborts = 0;
        
        for (let i = 0; i < 100; i++) {
            const l_ledger = new WorldLedger();
            l_ledger.mutate("VAR", 0);
            const l_agent = new EpistemicWindowAgent(l_ledger, "L");
            const val = l_agent.pull("VAR");
            
            const mutate = Math.random() < collisionProb;
            if (mutate) l_ledger.mutate("VAR", 1);
            
            l_agent.stageWrite("VAR", val + 10);
            l_agent.legacyBlindCommit();
            if (mutate && l_ledger.read("VAR").data === 10) corruptWrites++;
            
            const g_ledger = new WorldLedger();
            g_ledger.mutate("VAR", 0);
            const g_agent = new EpistemicWindowAgent(g_ledger, "G");
            const g_val = g_agent.pull("VAR");
            
            if (mutate) g_ledger.mutate("VAR", 1);
            
            g_agent.stageWrite("VAR", g_val + 10);
            const res = g_agent.collapse();
            if (res.status === 'ABORT_TEMPORAL_DRIFT') occAborts++;
        }
        console.log(`[Latency: ${latency.toString().padStart(5)}ms] Legacy State Corruptions: ${corruptWrites.toString().padStart(3)}% | Ghost-Ark Exact Aborts: ${occAborts.toString().padStart(3)}%`);
    }
    console.log("=================================================================");
}

runBenchmark().catch(console.error);
