import { PerformanceObserver, performance } from "node:perf_hooks";

export class LatencyTrap extends Error {}
export class OomTrap extends Error {}

export interface Budget { cpuMs: number; heapMB?: number; }

export function enforceRuntimePhysics(name: string, budget: Budget, targetExec: () => void, runs = 15) {
    if (!global.gc) return; 

    global.gc();
    const heapIn = process.memoryUsage().heapUsed;
    const ticks: number[] = [];

    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        targetExec();
        if (i >= 5) ticks.push(performance.now() - start);
    }
    
    global.gc();
    const memUsage = (process.memoryUsage().heapUsed - heapIn) / 1024 / 1024;
    
    const medianMs = ticks.sort((a,b)=>a-b)[Math.floor(ticks.length / 2)] || 0;
    if (medianMs > budget.cpuMs) throw new LatencyTrap(`[V8 TRAP] ${name} executed ${medianMs.toFixed(2)}ms (Limit ${budget.cpuMs}ms)`);
    if (budget.heapMB && memUsage > budget.heapMB) throw new OomTrap(`[OOM TRAP] ${name} allocated ${memUsage.toFixed(2)}MB RAM (Limit ${budget.heapMB}MB)`);
    
    return { medianMs, heapMB: memUsage };
}
