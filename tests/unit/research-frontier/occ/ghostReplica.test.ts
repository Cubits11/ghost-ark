import { describe, it, expect } from 'vitest';
import { WorldState, OccGate, GhostReplica, hashState } from '../../../../packages/research-frontier/src/occ/ghostReplica';
import { LpStatus } from '../../../../packages/research-frontier/src/unification/lpOracle';

describe('OCC Runtime Gate (Speculative Collapse)', () => {
    it('commits successfully when the world state is unmodified', () => {
        const world: WorldState = { 'agent_pos': { value: 0, version: 1, stateHash: hashState(0) } };
        const gate = new OccGate(world);
        const replica = new GhostReplica(world);

        const pos = replica.read('agent_pos');
        replica.write('agent_pos', pos + 1);

        // Small failure marginals that do not trip the temporal stopping bound
        const receipt = gate.commit(replica, [0.1]); 
        
        expect(receipt.status).toBe('COMMIT');
        expect(world['agent_pos'].value).toBe(1);
        expect(world['agent_pos'].version).toBe(2);
    });

    it('undergoes speculative collapse when the world state shifts during execution', () => {
        const world: WorldState = { 'balance': { value: 100, version: 1, stateHash: hashState(100) } };
        const gate = new OccGate(world);
        
        // Agent operates in a ghost replica
        const replica = new GhostReplica(world);
        const bal = replica.read('balance');
        replica.write('balance', bal - 50);

        // Meanwhile, an external force modifies the world state asynchronously
        gate.simulateExternalMutation('balance', 999);

        // Agent attempts to commit its speculative future
        const receipt = gate.commit(replica, [0.1]);

        expect(receipt.status).toBe('ABORT');
        if (receipt.status === 'ABORT') {
            expect(receipt.reason).toContain('Speculative collapse');
            expect(receipt.conflicts).toContain('balance');
        }
        
        // Ensure world state was NOT overwritten by the speculative replica
        expect(world['balance'].value).toBe(999);
        expect(world['balance'].version).toBe(2); // From the external mutation
    });

    it('annihilates the speculative future if the LP Oracle trips the temporal stopping bounds', () => {
        const world: WorldState = { 'task_progress': { value: 0, version: 1, stateHash: hashState(0) } };
        const gate = new OccGate(world);
        const replica = new GhostReplica(world);

        replica.read('task_progress');
        replica.write('task_progress', 100);

        // E.g., multiple concurrent failure probabilities sum to > 1
        // Under TEMPORAL_STOPPING, this mathematically proves an impossible state, triggering annihilation
        const impossibleMarginals = [0.6, 0.5]; 
        
        const receipt = gate.commit(replica, impossibleMarginals);

        expect(receipt.status).toBe('ABORT');
        if (receipt.status === 'ABORT') {
            expect(receipt.reason).toContain('LP Oracle refuted safety claim');
            expect(receipt.lpStatus).toBe(LpStatus.INFEASIBLE);
        }
        
        // No mutations apply
        expect(world['task_progress'].value).toBe(0);
        expect(world['task_progress'].version).toBe(1);
    });
});
