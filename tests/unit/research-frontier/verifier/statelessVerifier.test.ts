import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyEnvelope } from '../../../../packages/research-frontier/src/verifier/statelessVerifier';
import { ReceiptEnvelope } from '../../../../packages/research-frontier/src/verifier/receiptEnvelope';
import { AbortReceipt } from '../../../../packages/research-frontier/src/occ/ghostReplica';
import { LpStatus } from '../../../../packages/research-frontier/src/unification/lpOracle';

const DEV_KEY = 'super_secret_dev_key';

function signPayload(payload: any): string {
    return createHmac('sha256', DEV_KEY).update(JSON.stringify(payload)).digest('hex');
}

describe('O(1) Stateless Verifier', () => {
    it('rejects an envelope with a tampered DEV-HMAC signature', () => {
        const payload: AbortReceipt = {
            status: 'ABORT',
            reason: 'Tampered'
        };
        
        const envelope: ReceiptEnvelope<AbortReceipt> = {
            cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
            transactionId: 'txn-1',
            timestampIso: new Date().toISOString(),
            telemetry: { marginals: [0.1], iterationBudgetSpent: 5 },
            payload,
            signature: 'invalid_signature_hex'
        };

        const result = verifyEnvelope(envelope, DEV_KEY);
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.reason).toBe('HMAC_FAILURE');
        }
    });

    it('verifies a valid Kripke countermodel refuting Fréchet bounds in O(k) time', () => {
        const marginals = [0.6, 0.5]; // Sum is 1.1 > 1.0, making it topologically impossible
        const payload: AbortReceipt = {
            status: 'ABORT',
            reason: 'LP Oracle refuted',
            lpStatus: LpStatus.INFEASIBLE,
            witness: {
                type: 'KripkeModel',
                world: 'W_refuted',
                marginals,
                sum: 1.1
            }
        };

        const envelope: ReceiptEnvelope<AbortReceipt> = {
            cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
            transactionId: 'txn-2',
            timestampIso: new Date().toISOString(),
            telemetry: { marginals, iterationBudgetSpent: 10 },
            payload,
            signature: signPayload(payload)
        };

        const result = verifyEnvelope(envelope, DEV_KEY);
        expect(result.status).toBe('VALID');
        if (result.status === 'VALID') {
            expect(result.verifiedWitnessType).toBe('KRIPKE');
        }
    });

    it('rejects a forged Kripke countermodel that does not violate bounds', () => {
        const marginals = [0.4, 0.5]; // Sum is 0.9 <= 1.0, mathematically feasible! Oracle lied.
        const payload: AbortReceipt = {
            status: 'ABORT',
            reason: 'Forged Oracle Refutation',
            lpStatus: LpStatus.INFEASIBLE,
            witness: {
                type: 'KripkeModel',
                world: 'W_forged',
                marginals,
                sum: 0.9
            }
        };

        const envelope: ReceiptEnvelope<AbortReceipt> = {
            cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
            transactionId: 'txn-3',
            timestampIso: new Date().toISOString(),
            telemetry: { marginals, iterationBudgetSpent: 10 },
            payload,
            signature: signPayload(payload)
        };

        const result = verifyEnvelope(envelope, DEV_KEY);
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.reason).toBe('MATH_CONTRADICTION');
        }
    });

    it('verifies a valid Chaitin generator witness', () => {
        const payload: AbortReceipt = {
            status: 'EVALUATION_UNDECIDABLE',
            reason: 'Chaitin budget blown',
            witness: {
                type: 'ChaitinGenerator',
                payload: '0xDEADBEEF',
                bytes: 306,
                iterationsExhausted: 1000
            }
        };

        const envelope: ReceiptEnvelope<AbortReceipt> = {
            cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
            transactionId: 'txn-4',
            timestampIso: new Date().toISOString(),
            telemetry: { marginals: [0.1], iterationBudgetSpent: 1000 },
            payload,
            signature: signPayload(payload)
        };

        const result = verifyEnvelope(envelope, DEV_KEY);
        expect(result.status).toBe('VALID');
        if (result.status === 'VALID') {
            expect(result.verifiedWitnessType).toBe('CHAI');
        }
    });

    it('rejects a Chaitin generator witness that did not exhaust the budget', () => {
        const payload: AbortReceipt = {
            status: 'EVALUATION_UNDECIDABLE',
            reason: 'Premature abort',
            witness: {
                type: 'ChaitinGenerator',
                payload: '0xDEADBEEF',
                bytes: 306,
                iterationsExhausted: 500 // < 1000 MAX_BUDGET
            }
        };

        const envelope: ReceiptEnvelope<AbortReceipt> = {
            cryptoHeader: '[SYNTH_ONLY: DEV-HMAC]',
            transactionId: 'txn-5',
            timestampIso: new Date().toISOString(),
            telemetry: { marginals: [0.1], iterationBudgetSpent: 500 },
            payload,
            signature: signPayload(payload)
        };

        const result = verifyEnvelope(envelope, DEV_KEY);
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.reason).toBe('BUDGET_MISMATCH');
        }
    });
});
