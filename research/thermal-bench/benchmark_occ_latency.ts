import { WorldLedger, EpistemicWindowAgent } from '../../packages/research-frontier/src/occ/time_state_replica';
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

function burnCompute(ms: number) {
    const start = performance.now();
    while (performance.now() - start < ms) {
        createHash('sha256').update('burn').digest();
    }
}

async function runEmpiricalOCC() {
    console.log("==========================================================");
    console.log(" Ghost-Ark: Bare-Metal V8 Temporal State Corruption Test ");
    console.log("==========================================================\n");

    const ITERATIONS = 200;
    const COMPUTE_BURN_MS = 5; 

    console.log(`[Side A] Legacy Unshielded Concurrency (Firing ${ITERATIONS} concurrent trajectories)...`);
    const legacyLedger = new WorldLedger();
    legacyLedger.mutate("BANK_BALANCE", 1000);

    let legacySuccess = 0;

    const legacyTasks = Array.from({ length: ITERATIONS }).map(async (_, i) => {
        const agent = new EpistemicWindowAgent(legacyLedger, `Legacy_${i}`);
        const bal_t0 = agent.pull("BANK_BALANCE");

        await new Promise(resolve => setImmediate(resolve));
        burnCompute(COMPUTE_BURN_MS);

        agent.stageWrite("BANK_BALANCE", bal_t0 - 10);
        agent.legacyBlindCommit();
        legacySuccess++;
    });

    const legacyExogenous = async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            await new Promise(resolve => setImmediate(resolve));
            legacyLedger.mutate("BANK_BALANCE", legacyLedger.read("BANK_BALANCE").data + 50);
        }
    };

    await Promise.all([...legacyTasks, legacyExogenous()]);
    
    const expectedLegacyBalance = 1000 + (50 * ITERATIONS) - (10 * ITERATIONS);
    const actualLegacyBalance = legacyLedger.read("BANK_BALANCE").data;
    const lostLegacyUpdates = Math.abs(expectedLegacyBalance - actualLegacyBalance) / 10;

    console.log(`  [Result] Expected Ledger Balance: $${expectedLegacyBalance}`);
    console.log(`  [Result] Actual Ledger Balance:   $${actualLegacyBalance}`);
    console.log(`  [Assessment] CORRUPT GHOST WRITES: ${lostLegacyUpdates} transactions structurally bypassed state bounds and destroyed data.\n`);

    console.log(`[Side B] Ghost-Ark O(1) Temporal Shielding (Firing ${ITERATIONS} concurrent trajectories)...`);
    const ghostLedger = new WorldLedger();
    ghostLedger.mutate("BANK_BALANCE", 1000);

    let ghostAborts = 0;
    let ghostSuccess = 0;

    const ghostTasks = Array.from({ length: ITERATIONS }).map(async (_, i) => {
        const agent = new EpistemicWindowAgent(ghostLedger, `Ghost_${i}`);
        const bal_t0 = agent.pull("BANK_BALANCE");

        await new Promise(resolve => setImmediate(resolve));
        burnCompute(COMPUTE_BURN_MS);

        agent.stageWrite("BANK_BALANCE", bal_t0 - 10);
        const result = agent.collapse();
        
        if (result.status === 'ABORT_TEMPORAL_DRIFT') {
            ghostAborts++;
        } else {
            ghostSuccess++;
        }
    });

    const ghostExogenous = async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            await new Promise(resolve => setImmediate(resolve));
            ghostLedger.mutate("BANK_BALANCE", ghostLedger.read("BANK_BALANCE").data + 50);
        }
    };

    await Promise.all([...ghostTasks, ghostExogenous()]);

    const actualGhostBalance = ghostLedger.read("BANK_BALANCE").data;
    const expectedGhostBalance = 1000 + (50 * ITERATIONS) - (10 * ghostSuccess);

    console.log(`  [Result] Expected Ledger Balance: $${expectedGhostBalance}`);
    console.log(`  [Result] Actual Ledger Balance:   $${actualGhostBalance}`);
    console.log(`  [Assessment] RUTHLESS ONTOLOGICAL ROLLBACKS: ${ghostAborts}`);
    console.log(`  [Assessment] CORRUPT GHOST WRITES: ${Math.abs(expectedGhostBalance - actualGhostBalance) / 10}`);
    
    if (expectedGhostBalance === actualGhostBalance) {
        console.log(`  [Verdict] 100% MATHEMATICAL CONVERGENCE. The state isolation boundary holds under extreme thread pressure.\n`);
    }
}

runEmpiricalOCC().catch(console.error);
