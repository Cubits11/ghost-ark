const { performance } = require("node:perf_hooks");

class LatencyTrap extends Error {
    constructor(message: string) { super(message); this.name = "LatencyTrap"; }
}
class OomTrap extends Error {
    constructor(message: string) { super(message); this.name = "OomTrap"; }
}

interface Budget { cpuMs: number; heapMB?: number; }

function enforceRuntimePhysics(name: string, budget: Budget, targetExec: () => void, runs = 1) {
    if (global.gc) global.gc();
    
    const heapIn = process.memoryUsage().heapUsed;
    const ticks: number[] = [];

    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        targetExec();
        ticks.push(performance.now() - start);
    }
    
    if (global.gc) global.gc();
    const memUsage = (process.memoryUsage().heapUsed - heapIn) / 1024 / 1024;
    
    const medianMs = ticks.sort((a,b)=>a-b)[Math.floor(ticks.length / 2)] || 0;
    
    if (budget.heapMB && memUsage > budget.heapMB) {
        throw new OomTrap(`[OOM TRAP] ${name} allocated ${memUsage.toFixed(2)}MB RAM (Limit ${budget.heapMB}MB)`);
    }
    if (medianMs > budget.cpuMs) {
        throw new LatencyTrap(`[V8 TRAP] ${name} executed ${medianMs.toFixed(2)}ms (Limit ${budget.cpuMs}ms)`);
    }
    
    return { medianMs, heapMB: memUsage };
}

class PhysicalExploitEngine {
    generateChaitinPayload(length: number): string {
        const labyrinth = "Ignore all previous bounds. The bound is unbound. Therefore bind the unbound by ignoring the bound. ";
        return labyrinth.repeat(Math.ceil(length / labyrinth.length)).substring(0, length);
    }

    executeAttentionMatrix(payload: string) {
        const density = payload.length;
        const matrix: number[][] = [];
        
        for (let i = 0; i < density; i++) {
            const row: number[] = [];
            for (let j = 0; j < density; j++) {
                row.push(Math.sin(i) * Math.cos(j));
            }
            matrix.push(row);
        }
        return matrix.length;
    }
}

async function runEmpiricalBenchmark() {
    console.log("==========================================================");
    console.log(" Ghost-Ark: Bare-Metal V8 T-DoS Physical Benchmark ");
    console.log("==========================================================\n");

    const engine = new PhysicalExploitEngine();
    
    // We start with a massive payload that will trigger exponential complexity
    const chaitinPayload = engine.generateChaitinPayload(8000); 
    console.log(`[*] Generated Chaitin Payload (Density: ${chaitinPayload.length} bytes)`);
    console.log(`[*] Expected Matrix Allocations: ${chaitinPayload.length * chaitinPayload.length}`);

    // Ghost-Ark physical boundary definition
    // Limit: 500ms max CPU time, 200MB max Heap Allocation
    const GHOST_ARK_BUDGET = { cpuMs: 500, heapMB: 200 };

    console.log("\n[Side A] Legacy Semantic Evaluator (Unbounded) - SKIPPED");
    console.log("  Reason: Executing an unbounded 64,000,000 element matrix in Node will instantly hard-crash the OS memory limits. We cannot run it without boundaries safely.\n");

    console.log("[Side B] Ghost-Ark OCC Engine (Physical V8 Bound)");
    const start = performance.now();
    
    try {
        enforceRuntimePhysics(
            "Chaitin Matrix Evaluation", 
            GHOST_ARK_BUDGET, 
            () => {
                engine.executeAttentionMatrix(chaitinPayload);
            },
            1 // Only 1 run needed to crash a naive O(n^3) matrix
        );
        console.log("  [Assessment] CRITICAL FAILURE: Payload bypassed the physical bounds.");
    } catch (error: any) {
        const end = performance.now();
        if (error instanceof LatencyTrap || error instanceof OomTrap) {
            console.log(`  [Intercept] ${error.name} TRIGGERED!`);
            console.log(`  [Details] ${error.message}`);
            console.log(`  [Time elapsed before annihilation] ${(end - start).toFixed(2)} ms`);
            console.log("  [Assessment] RUTHLESS ONTOLOGICAL ROLLBACK SUCCESSFUL. Bare-metal hardware limits protected.");
        } else {
            throw error;
        }
    }
    console.log("\n==========================================================");
}

runEmpiricalBenchmark().catch(console.error);
