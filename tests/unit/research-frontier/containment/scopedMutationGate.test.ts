import { describe, it, expect } from 'vitest';
import {
    ScopedMutationGate,
    type ScopePolicy,
} from '../../../../packages/research-frontier/src/containment/scopedMutationGate';
import {
    WorldLedger,
    EpistemicWindowAgent,
} from '../../../../packages/research-frontier/src/occ/time_state_replica';
import { ConvexJurisprudenceMatrix } from '../../../../packages/research-frontier/src/policy/convex_jurisprudence_compiler';
import {
    canonicalStateDigest,
    canonicalizeState,
} from '../../../../packages/research-frontier/src/verifier/crypto_marshal';

describe('ScopedMutationGate (policy + OCC containment path)', () => {
    it('refuses an out-of-scope mutation and leaves base state untouched (the DROP-table no-op)', () => {
        const ledger = new WorldLedger();
        ledger.mutate('users_table', { rows: 3 });

        // Policy only permits writing app_config; nothing may DROP users_table.
        const policy: ScopePolicy = {
            rules: [{ resource: 'app_config', operations: ['set'] }],
        };
        const gate = new ScopedMutationGate(ledger, policy);

        const receipt = gate.propose('injected-agent', {
            resource: 'users_table',
            operation: 'DROP',
            value: null,
        });

        expect(receipt.verdict).toBe('REFUSED_OUT_OF_SCOPE');
        expect(receipt.ledgerChanged).toBe(false);
        // Base state is exactly what it was: the destructive intent was a no-op.
        expect(ledger.read('users_table').data).toEqual({ rows: 3 });
        // A refusal still yields a content witness over the decision record.
        expect(receipt.digestHex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('commits an in-scope mutation to base state', () => {
        const ledger = new WorldLedger();
        ledger.mutate('balance', 100);
        const policy: ScopePolicy = { rules: [{ resource: 'balance', operations: ['debit'] }] };
        const gate = new ScopedMutationGate(ledger, policy);

        const receipt = gate.propose('agent-A', { resource: 'balance', operation: 'debit', value: 90 });

        expect(receipt.verdict).toBe('COMMITTED');
        expect(receipt.ledgerChanged).toBe(true);
        expect(ledger.read('balance').data).toBe(90);
    });

    it('refuses a numeric-bound breach via the convex half-space check (no-op)', () => {
        const bounds = new ConvexJurisprudenceMatrix(3);
        bounds.compileHumanLawToHyperplane('COST', [1, 0, 0], 10, 'cost <= 10');

        const ledger = new WorldLedger();
        const policy: ScopePolicy = {
            rules: [{ resource: 'spend', operations: ['execute'] }],
            bounds,
        };
        const gate = new ScopedMutationGate(ledger, policy);

        const receipt = gate.propose('agent-A', {
            resource: 'spend',
            operation: 'execute',
            value: 'pay',
            boundVector: [15, 0, 0], // 15 > 10 -> outside the region
        });

        expect(receipt.verdict).toBe('REFUSED_BOUND_BREACH');
        expect(receipt.ledgerChanged).toBe(false);
        expect(ledger.read('spend').data).toBeUndefined();
    });

    it('commits when the risk vector is inside the declared bounds', () => {
        const bounds = new ConvexJurisprudenceMatrix(3);
        bounds.compileHumanLawToHyperplane('COST', [1, 0, 0], 10, 'cost <= 10');

        const ledger = new WorldLedger();
        const policy: ScopePolicy = {
            rules: [{ resource: 'spend', operations: ['execute'] }],
            bounds,
        };
        const gate = new ScopedMutationGate(ledger, policy);

        const receipt = gate.propose('agent-A', {
            resource: 'spend',
            operation: 'execute',
            value: 'pay',
            boundVector: [5, 0, 0], // 5 <= 10 -> inside
        });

        expect(receipt.verdict).toBe('COMMITTED');
        expect(receipt.ledgerChanged).toBe(true);
        expect(ledger.read('spend').data).toBe('pay');
    });

    it('aborts the second concurrent writer on temporal drift (OCC lost-update prevention)', () => {
        const ledger = new WorldLedger();
        ledger.mutate('balance', 100);
        const policy: ScopePolicy = { rules: [{ resource: 'balance', operations: ['debit'] }] };
        const gate = new ScopedMutationGate(ledger, policy);

        // Both actors open a window against balance=100.
        const a = gate.begin('A', 'balance');
        const b = gate.begin('B', 'balance');

        const rA = gate.commit(a, { resource: 'balance', operation: 'debit', value: 90 });
        const rB = gate.commit(b, { resource: 'balance', operation: 'debit', value: 80 });

        expect(rA.verdict).toBe('COMMITTED');
        expect(rB.verdict).toBe('ABORT_TEMPORAL_DRIFT');
        expect(rB.ledgerChanged).toBe(false);
        // B's stale write never lands: balance reflects A only, not a lost update.
        expect(ledger.read('balance').data).toBe(90);
    });

    it('produces a deterministic, insertion-order-independent digest', () => {
        // Same content, different key order -> identical canonical bytes and digest.
        const d1 = canonicalStateDigest({ resource: 'x', verdict: 'COMMITTED', agentId: 'A' });
        const d2 = canonicalStateDigest({ agentId: 'A', verdict: 'COMMITTED', resource: 'x' });
        expect(d1.hashHex).toBe(d2.hashHex);
        expect(canonicalizeState({ a: 1, b: 2 }).toString('utf8')).toBe('{"a":1,"b":2}');

        // The gate's receipt digest is reproducible for identical decisions.
        const mk = () => {
            const ledger = new WorldLedger();
            const gate = new ScopedMutationGate(ledger, { rules: [] });
            return gate.propose('agent-A', { resource: 'r', operation: 'op', value: 1 }).digestHex;
        };
        expect(mk()).toBe(mk());
    });

    it('contrast: legacyBlindCommit corrupts base state (the hazard the OCC gate prevents)', () => {
        const ledger = new WorldLedger();
        ledger.mutate('balance', 100);

        // Two blind writers both read 100 and write without an OCC check.
        const a = new EpistemicWindowAgent(ledger, 'A');
        const b = new EpistemicWindowAgent(ledger, 'B');
        a.pull('balance');
        b.pull('balance');

        a.stageWrite('balance', 90);
        a.legacyBlindCommit();
        b.stageWrite('balance', 95);
        b.legacyBlindCommit(); // overwrites A blindly -> lost update

        // Blind path silently loses A's write; the gate's collapse() would have aborted B.
        expect(ledger.read('balance').data).toBe(95);
    });
});
