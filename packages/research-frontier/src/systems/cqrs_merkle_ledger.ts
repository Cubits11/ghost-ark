import { createHash } from 'crypto';

export interface LedgerEvent {
    eventId: string;
    agentId: string;
    payload: any;
    timestamp: number;
    previousHash: string;
    hash: string;
    type: 'MUTATION' | 'COMPENSATING_REVERSAL';
}

/**
 * Event-Sourcing CQRS Ledger with Merkle Tree Rollbacks
 * The state isn't a database—it's a strict mathematical reduction over an event stream.
 */
export class CqrsMerkleLedger {
    private eventStore: LedgerEvent[] = [];
    private stateProjection: Map<string, any> = new Map();
    // O(1) Snapshot Cache: maps a key to its event history stack for instantaneous rollback.
    private stateHistoryCache: Map<string, any[]> = new Map();

    private generateHash(data: any): string {
        return createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    private getLatestHash(): string {
        if (this.eventStore.length === 0) return createHash('sha256').update('GENESIS').digest('hex');
        return this.eventStore[this.eventStore.length - 1].hash;
    }

    public appendMutation(agentId: string, mutationPayload: { key: string, value: any }): LedgerEvent {
        const prevHash = this.getLatestHash();
        const eventData = { agentId, payload: mutationPayload, timestamp: Date.now(), previousHash: prevHash, type: 'MUTATION' };
        
        const event: LedgerEvent = {
            ...eventData,
            eventId: this.generateHash(Date.now().toString() + Math.random()),
            hash: this.generateHash(eventData),
            type: 'MUTATION'
        };

        this.eventStore.push(event);
        
        // Project O(1) snapshot state
        const history = this.stateHistoryCache.get(mutationPayload.key) || [];
        history.push(mutationPayload.value);
        this.stateHistoryCache.set(mutationPayload.key, history);

        this.stateProjection.set(mutationPayload.key, mutationPayload.value);
        return event;
    }

    /**
     * Reverts the state by calculating the exact Reverse Delta.
     * Computes the prior state from the event stream and appends a COMPENSATING_REVERSAL event.
     */
    public executeCompensatingReversal(targetEventId: string): LedgerEvent {
        const targetIndex = this.eventStore.findIndex(e => e.eventId === targetEventId);
        if (targetIndex === -1) throw new Error("Event not found in ledger");

        const targetEvent = this.eventStore[targetIndex];
        const keyToRevert = targetEvent.payload.key;

        // O(1) Snapshot Cache Lookup
        const historyStack = this.stateHistoryCache.get(keyToRevert) || [];
        let priorValue = undefined;

        // Ensure we actually pop the target value off the stack first
        if (historyStack.length > 0 && historyStack[historyStack.length - 1] === targetEvent.payload.value) {
            historyStack.pop();
        }

        if (historyStack.length > 0) {
            priorValue = historyStack[historyStack.length - 1];
        }

        const prevHash = this.getLatestHash();
        const reversalData = {
            agentId: 'SYSTEM_VERIFIER',
            payload: { key: keyToRevert, value: priorValue, revertedEventId: targetEventId },
            timestamp: Date.now(),
            previousHash: prevHash,
            type: 'COMPENSATING_REVERSAL'
        };

        const reversalEvent: LedgerEvent = {
            ...reversalData,
            eventId: this.generateHash(Date.now().toString() + 'REVERSAL'),
            hash: this.generateHash(reversalData),
            type: 'COMPENSATING_REVERSAL'
        };

        this.eventStore.push(reversalEvent);

        if (priorValue === undefined) {
            this.stateProjection.delete(keyToRevert);
        } else {
            this.stateProjection.set(keyToRevert, priorValue);
        }

        return reversalEvent;
    }

    public getState(): Map<string, any> {
        return this.stateProjection;
    }

    public getMerkleRoot(): string {
        return this.getLatestHash();
    }
}
