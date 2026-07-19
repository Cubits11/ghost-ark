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
 * WorldLedger - the committed baseline state.
 * A key/value store that also records a SHA-256 hash per key, so a reader can
 * later detect whether a key changed between its read and its commit attempt.
 * This is lock-free optimistic concurrency control (OCC), not a mutex.
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
     * OCC validation: for every key the caller read, compare the hash it saw
     * then against the current hash. Any mismatch aborts the whole write-set;
     * otherwise all staged writes are applied atomically.
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
 * EpistemicWindowAgent - one actor's speculative buffer: the keys it has read
 * (with the hashes seen at read time), plus a staged write-set not yet applied
 * to the ledger.
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
     * Attempt to commit the staged write-set under OCC. On conflict the staged
     * work is discarded and the base ledger is left untouched (a no-op).
     */
    public collapse(): { status: string, conflicts: string[] } {
        const result = this.ledger.commitSpeculative(this.writeSet, this.readHashSnapshot);
        if (result.status === 'ABORT_TEMPORAL_DRIFT') {
            // Conflict: drop the speculative write-set; base state is unchanged.
            this.writeSet.clear();
            this.readHashSnapshot.clear();
            this.readSet.clear();
        }
        return result;
    }

    /**
     * Non-OCC baseline: apply the write-set unconditionally, ignoring whether the
     * state changed since the read. Used only to demonstrate the lost-update
     * hazard that the OCC path (collapse) prevents.
     */
    public legacyBlindCommit(): void {
        for (const [key, data] of this.writeSet.entries()) {
            this.ledger.mutate(key, data);
        }
    }
}
