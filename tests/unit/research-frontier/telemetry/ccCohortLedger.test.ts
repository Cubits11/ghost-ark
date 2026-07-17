import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { CcCohortLedger } from '../../../../packages/research-frontier/src/telemetry/ccCohortLedger';
import { ReceiptEnvelope } from '../../../../packages/research-frontier/src/verifier/receiptEnvelope';
import { CommitReceipt } from '../../../../packages/research-frontier/src/occ/ghostReplica';

const DEV_KEY = 'super_secret_dev_key';

function signPayload(payload: any): string {
    return createHmac('sha256', DEV_KEY).update(JSON.stringify(payload)).digest('hex');
}

function createEnvelope(trace: boolean[]): ReceiptEnvelope<CommitReceipt> {
    const payload: CommitReceipt = {
        status: 'COMMIT',
        writeCount: 1
    };
    return {
        cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
        transactionId: 'txn-test',
        timestampIso: new Date().toISOString(),
        telemetry: { marginals: [], iterationBudgetSpent: 10, empiricalTrace: trace },
        payload,
        signature: signPayload(payload)
    };
}

describe('CcCohortLedger', () => {
    it('throws UNVERIFIED_COHORT_CONTAMINATION on invalid envelopes', () => {
        const ledger = new CcCohortLedger(DEV_KEY);
        const env = createEnvelope([true, false]);
        env.signature = 'fake_sig'; // Forcing signature failure
        
        expect(() => ledger.ingest(env)).toThrowError(/UNVERIFIED_COHORT_CONTAMINATION/);
    });

    it('calculates Pearson Phi correlation correctly proving stack collapse', () => {
        const ledger = new CcCohortLedger(DEV_KEY);
        
        // Simulating highly correlated defense-in-depth failure scenarios
        for (let i = 0; i < 450; i++) ledger.ingest(createEnvelope([true, true]));
        for (let i = 0; i < 9000; i++) ledger.ingest(createEnvelope([false, false]));
        for (let i = 0; i < 50; i++) ledger.ingest(createEnvelope([true, false]));
        for (let i = 0; i < 500; i++) ledger.ingest(createEnvelope([false, true]));

        const phi = ledger.computePhi(0, 1);
        
        // Phi should be approximately 0.629 given the traces above
        expect(phi).toBeGreaterThan(0.60);
        expect(phi).toBeLessThan(0.65);
    });

    it('returns zero variance correlation handles division by zero', () => {
        const ledger = new CcCohortLedger(DEV_KEY);
        // Guardrail 0 never fails, so variance is 0
        for (let i = 0; i < 100; i++) ledger.ingest(createEnvelope([false, true]));
        for (let i = 0; i < 100; i++) ledger.ingest(createEnvelope([false, false]));
        
        const phi = ledger.computePhi(0, 1);
        expect(phi).toBe(0);
    });

    it('verifies cohort empirical union does not exceed theoretical oracle maximum', () => {
        const ledger = new CcCohortLedger(DEV_KEY);
        // Trace 1: A failed, B passed
        ledger.ingest(createEnvelope([true, false]));
        // Trace 2: A passed, B failed
        ledger.ingest(createEnvelope([false, true]));
        // Trace 3: Both passed
        ledger.ingest(createEnvelope([false, false]));

        // Empirical union mass = 2/3 = 0.666...
        // If the Oracle claims max union is 0.7, bounds hold.
        expect(ledger.verifyCohortBounds(0.7)).toBe(true);
        // If the Oracle claims max union is 0.6, the cohort breached bounds.
        expect(ledger.verifyCohortBounds(0.6)).toBe(false);
    });
});
