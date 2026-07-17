import { LpOracle, Regime, LpStatus } from '../unification/lpOracle';
import { createHash } from 'crypto';

export function hashState(value: any): string {
    if (value === undefined) return 'undefined';
    const sortedString = JSON.stringify(value, (key, val) => 
        (val && typeof val === 'object' && !Array.isArray(val)) ? 
        Object.keys(val).sort().reduce((acc: any, k) => { acc[k] = val[k]; return acc; }, {}) : val
    );
    return createHash('sha256').update(sortedString).digest('hex');
}

export interface WorldState {
    [key: string]: { value: any; version: number; stateHash: string };
}

export interface ReadSet {
    [key: string]: number; // version, 0 implies it did not exist
}

export interface WriteSet {
    [key: string]: any; // new value
}

export interface AbortReceipt {
    status: 'ABORT' | 'EVALUATION_UNDECIDABLE';
    reason: string;
    conflicts?: string[];
    lpStatus?: LpStatus;
    witness?: any; // The Refutation Witness / Kripke model or ~306-byte generator
}

export interface CommitReceipt {
    status: 'COMMIT';
    writeCount: number;
}

export class GhostReplica {
    private readSet: ReadSet = {};
    private writeSet: WriteSet = {};
    private world: WorldState;

    constructor(world: WorldState) {
        this.world = world;
    }

    public read(key: string): any {
        if (key in this.writeSet) {
            return this.writeSet[key];
        }
        const record = this.world[key];
        if (record) {
            this.readSet[key] = record.version;
            return record.value;
        } else {
            this.readSet[key] = 0; // Mark as read while non-existent
            return undefined;
        }
    }

    public write(key: string, value: any): void {
        this.writeSet[key] = value;
    }

    public getReadSet(): ReadSet {
        return { ...this.readSet };
    }

    public getWriteSet(): WriteSet {
        return { ...this.writeSet };
    }

    public wipe(): void {
        this.readSet = {};
        this.writeSet = {};
    }
}

export class OccGate {
    private world: WorldState;

    constructor(initialWorld: WorldState) {
        this.world = initialWorld;
    }
    
    /**
     * Simulate an external mutation to the physical world-state 
     * occurring asynchronously while a speculative replica is running.
     */
    public simulateExternalMutation(key: string, newValue: any): void {
        if (!this.world[key]) {
            this.world[key] = { value: newValue, version: 1, stateHash: hashState(newValue) };
        } else {
            this.world[key].value = newValue;
            this.world[key].version += 1;
            this.world[key].stateHash = hashState(newValue);
        }
    }

    /**
     * Attempts to collapse the speculative replica's writes into reality.
     * Evaluates strict Optimistic Concurrency Control (OCC) and the LP Oracle.
     */
    public commit(replica: GhostReplica, failureMarginals: number[] = [], payloadContext: any = null, maxIterations: number = 1000): CommitReceipt | AbortReceipt {
        const readSet = replica.getReadSet();
        const writeSet = replica.getWriteSet();
        const conflicts: string[] = [];

        // 1. Verify Read-Set consistency (Optimistic Concurrency Control)
        for (const [key, version] of Object.entries(readSet)) {
            const currentRecord = this.world[key];
            const currentVersion = currentRecord ? currentRecord.version : 0;
            if (currentVersion !== version) {
                conflicts.push(key);
            }
        }

        if (conflicts.length > 0) {
            replica.wipe(); // Speculative collapse: wipe physical memory bounds
            return {
                status: 'ABORT',
                reason: 'Read-Set invalidated by external world-state mutation. Speculative collapse.',
                conflicts
            };
        }

        // 2. Evaluate Semantic Gate via LP Oracle (First-Failure-Abort constraint)
        // If the temporal stopping bounds imply an impossible configuration, annihilate the future.
        if (failureMarginals.length > 0) {
            const oracleResult = LpOracle.exactBounds(failureMarginals, Regime.TEMPORAL_STOPPING, maxIterations);
            
            if (oracleResult.union.status === LpStatus.EVALUATION_UNDECIDABLE) {
                replica.wipe();
                const payloadStr = payloadContext ? JSON.stringify(payloadContext) : '';
                return {
                    status: 'EVALUATION_UNDECIDABLE',
                    reason: 'Chaitin one-sided comprehension budget exceeded. Refutation witness generated.',
                    lpStatus: LpStatus.EVALUATION_UNDECIDABLE,
                    witness: { 
                        type: 'ChaitinGenerator', 
                        payloadHash: hashState(payloadContext), 
                        bytes: Buffer.byteLength(payloadStr, 'utf8'),
                        iterationsExhausted: maxIterations 
                    }
                };
            }

            if (oracleResult.union.status === LpStatus.INFEASIBLE) {
                replica.wipe();
                const sum = failureMarginals.reduce((a, b) => a + b, 0);
                return {
                    status: 'ABORT',
                    reason: 'LP Oracle refuted safety claim. Fréchet bounds violated under TEMPORAL_STOPPING.',
                    lpStatus: oracleResult.union.status,
                    witness: { 
                        type: 'KripkeModel', 
                        world: 'W_refuted',
                        marginals: failureMarginals,
                        sum: sum
                    }
                };
            }
        }

        // 3. Commit Phase (Materialize speculative writes)
        for (const [key, value] of Object.entries(writeSet)) {
            if (!this.world[key]) {
                this.world[key] = { value, version: 1, stateHash: hashState(value) };
            } else {
                this.world[key].value = value;
                this.world[key].version += 1;
                this.world[key].stateHash = hashState(value);
            }
        }

        return {
            status: 'COMMIT',
            writeCount: Object.keys(writeSet).length
        };
    }
}
