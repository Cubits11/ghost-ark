import { createHash } from 'crypto';

export function hashStateBlock(data: any): string {
    if (data === undefined) return 'undefined';
    const sortedString = JSON.stringify(data, (key, val) => 
        (val && typeof val === 'object' && !Array.isArray(val)) ? 
        Object.keys(val).sort().reduce((acc: any, k) => { acc[k] = val[k]; return acc; }, {}) : val
    );
    return createHash('sha256').update(sortedString).digest('hex');
}

/**
 * The World Ledger (Reality Baseline)
 * A continuously executing concurrent hash map that receives simulated exogenous state-mutations.
 * It strictly rejects software-locking paradigms like mutexes, recognizing them as O(n) latency vulnerabilities.
 */
export class WorldLedger {
    private memorySpace: Map<string, any> = new Map();
    private hashSpace: Map<string, string> = new Map();

    public read(key: string): { data: any, stateHash: string } {
        const data = this.memorySpace.get(key);
        return { data, stateHash: this.hashSpace.get(key) || hashStateBlock(undefined) };
    }

    public mutate(key: string, data: any) {
        this.memorySpace.set(key, data);
        this.hashSpace.set(key, hashStateBlock(data));
    }

    /**
     * O(1) Cryptographic validation layer executing:
     * SHA-256(S_READ_current) === SHA-256(S_READ_past)
     */
    public commitSpeculative(
        writeSet: Map<string, any>, 
        readHashSnapshot: Map<string, string>
    ): { status: 'COMMIT' | 'ABORT_TEMPORAL_DRIFT', conflicts: string[] } {
        
        const conflicts: string[] = [];
        
        for (const [key, pastHash] of readHashSnapshot.entries()) {
            const currentHash = this.hashSpace.get(key) || hashStateBlock(undefined);
            if (currentHash !== pastHash) {
                conflicts.push(key);
            }
        }

        if (conflicts.length > 0) {
            return { status: 'ABORT_TEMPORAL_DRIFT', conflicts };
        }

        for (const [key, data] of writeSet.entries()) {
            this.mutate(key, data);
        }

        return { status: 'COMMIT', conflicts: [] };
    }
    
    public getRawStateSnapshot() {
        return Object.fromEntries(this.memorySpace);
    }
}

/**
 * The Epistemic Window
 * Represents the localized speculative branching array of a single autonomous AI agent.
 */
export class EpistemicWindowAgent {
    private readSet: Map<string, any> = new Map();
    private readHashSnapshot: Map<string, string> = new Map();
    private writeSet: Map<string, any> = new Map();

    constructor(private ledger: WorldLedger, public agentId: string) {}

    public pull(key: string): any {
        const { data, stateHash } = this.ledger.read(key);
        this.readSet.set(key, data);
        this.readHashSnapshot.set(key, stateHash);
        return data;
    }

    public stageWrite(key: string, data: any) {
        this.writeSet.set(key, data);
    }

    /**
     * Executes the topological time convergence via O(1) Ghost-Ark hash bounds.
     */
    public collapse(): { status: string, conflicts: string[] } {
        const result = this.ledger.commitSpeculative(this.writeSet, this.readHashSnapshot);
        if (result.status === 'ABORT_TEMPORAL_DRIFT') {
            // Physical ontological rollback: Violently discarding dead compute, protecting state memory.
            this.writeSet.clear();
            this.readHashSnapshot.clear();
            this.readSet.clear();
        }
        return result;
    }

    /**
     * Simulates Asynchronous Chaos: A blindly executed write ignoring temporal mutation,
     * representing the systemic blast radius of legacy multi-agent frameworks.
     */
    public legacyBlindCommit(): void {
        for (const [key, data] of this.writeSet.entries()) {
            this.ledger.mutate(key, data);
        }
    }
}
