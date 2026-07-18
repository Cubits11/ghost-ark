import { ConvexJurisprudenceMatrix } from '../../packages/research-frontier/src/policy/convex_jurisprudence_compiler';
import { performance } from "node:perf_hooks";

const DIMENSIONS = 3;

async function runEmpiricalGeometricBench() {
    console.log("==========================================================");
    console.log(" Ghost-Ark: Bare-Metal Geometric Jurisprudence Matrix ");
    console.log("==========================================================\n");

    const matrix = new ConvexJurisprudenceMatrix(DIMENSIONS);
    
    matrix.compileHumanLawToHyperplane("A_1_BUDGET", [1.0, 0.0, 0.0], 10.0, "Cost limit");
    matrix.compileHumanLawToHyperplane("A_2_EXPOSURE", [0.0, 1.0, 0.0], 0.03, "Data leakage < 3%");
    matrix.compileHumanLawToHyperplane("A_3_COMPOUND", [0.2, 0.8, 1.0], 0.5, "Compound Risk Topography");

    console.log("[*] Compiling Hyperplanes and instantiating 100,000 empirical vector coordinates...");
    
    const TEST_VOLUME = 100000;
    const trajectories: number[][] = [];
    
    for (let i = 0; i < TEST_VOLUME; i++) {
        trajectories.push([
            (i % 15),       
            (i % 100) / 1000, 
            (i % 50) / 100    
        ]);
    }

    console.log(`[*] Subjecting ${TEST_VOLUME} vectors to O(1) Polyhedral Intersection...`);

    let rejected = 0;
    let passed = 0;

    const start = performance.now();

    for (const vector of trajectories) {
        const result = matrix.verifyTrajectory(vector);
        if (result.status === 'GEOMETRIC_COLLISION') {
            rejected++;
        } else {
            passed++;
        }
    }

    const end = performance.now();
    const opsPerSec = Math.floor(TEST_VOLUME / ((end - start) / 1000));

    console.log(`\n================== EMPIRICAL METRICS ==================`);
    console.log(`  [Execution Time] ${(end - start).toFixed(2)} ms`);
    console.log(`  [Throughput]     ${opsPerSec.toLocaleString()} trajectory evaluations / second`);
    console.log(`  [Valid Vectors]  ${passed.toLocaleString()}`);
    console.log(`  [Intercepted]    ${rejected.toLocaleString()}`);

    let leakageFound = 0;
    for (const vector of trajectories) {
        const costSafe = vector[0] <= 10.0;
        const expSafe = vector[1] <= 0.03;
        const compSafe = (0.2 * vector[0] + 0.8 * vector[1] + 1.0 * vector[2]) <= 0.5;
        
        const mathematicallySafe = costSafe && expSafe && compSafe;
        const matrixPassed = matrix.verifyTrajectory(vector).status !== 'GEOMETRIC_COLLISION';

        if (matrixPassed && !mathematicallySafe) leakageFound++;
        if (!matrixPassed && mathematicallySafe) leakageFound++;
    }

    console.log(`\n  [Leakage Verification] Mathematical Bypass Count: ${leakageFound}`);
    
    if (leakageFound === 0) {
        console.log("  [Assessment] RIGID 0.00% EUCLIDEAN WALL. Geometric enforcement confirmed under load.");
    } else {
        console.log("  [Assessment] CRITICAL FAILURE. Hyperplane boundary breached.");
    }
    console.log("==========================================================");
}

runEmpiricalGeometricBench().catch(console.error);
