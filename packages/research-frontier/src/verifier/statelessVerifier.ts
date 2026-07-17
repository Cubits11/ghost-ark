import { createHmac } from 'crypto';
import { ReceiptEnvelope } from './receiptEnvelope';
import { CommitReceipt, AbortReceipt, hashState } from '../occ/ghostReplica';

export type VerificationResult = 
    | { status: 'VALID'; verifiedWitnessType: 'CHAI' | 'KRIPKE' | 'COMMIT' }
    | { status: 'INVALID'; reason: 'HMAC_FAILURE' | 'MATH_CONTRADICTION' | 'BUDGET_MISMATCH' };

const MAX_ITERATION_BUDGET = 1000;
const EPS = 1e-9;

/**
 * The O(1) Stateless Verifier for Ghost-Ark Receipts.
 * 
 * Takes an exact-math envelope and verifies the cryptographic signature
 * and the O(1) refutation properties without invoking the heavy LP oracle.
 */
export function verifyEnvelope<T extends CommitReceipt | AbortReceipt>(
    envelope: ReceiptEnvelope<T>, 
    devKey: string
): VerificationResult {
    // 1. Verify DEV-HMAC Signature
    // In practice, deterministic JSON serialization is required.
    const payloadStr = Buffer.from(hashState(envelope.payload), 'utf8');
    const expectedMac = createHmac('sha256', devKey).update(payloadStr).digest('hex');
    
    if (envelope.signature !== expectedMac) {
        return { status: 'INVALID', reason: 'HMAC_FAILURE' };
    }

    // 2. Validate based on receipt type
    if (envelope.payload.status === 'COMMIT') {
        return { status: 'VALID', verifiedWitnessType: 'COMMIT' };
    }

    if (envelope.payload.status === 'EVALUATION_UNDECIDABLE') {
        const witness = envelope.payload.witness;
        if (!witness || witness.type !== 'ChaitinGenerator') {
            return { status: 'INVALID', reason: 'MATH_CONTRADICTION' };
        }
        
        // Verifying the ChaitinGeneratorWitness:
        if (witness.iterationsExhausted < MAX_ITERATION_BUDGET) {
            return { status: 'INVALID', reason: 'BUDGET_MISMATCH' };
        }
        
        if (envelope.telemetry.iterationBudgetSpent < MAX_ITERATION_BUDGET) {
            return { status: 'INVALID', reason: 'BUDGET_MISMATCH' };
        }

        return { status: 'VALID', verifiedWitnessType: 'CHAI' };
    }

    if (envelope.payload.status === 'ABORT') {
        const witness = envelope.payload.witness;
        if (!witness || witness.type !== 'KripkeModel') {
            // A standard speculative conflict abort without a Kripke model is an OCC conflict.
            return { status: 'VALID', verifiedWitnessType: 'COMMIT' }; 
        }

        // Verifying the KripkeCountermodel (Fréchet Refutation):
        const marginals = witness.marginals;
        const sum = marginals.reduce((a: number, b: number) => a + b, 0);
        
        // Validate internal mathematical consistency of the witness
        if (Math.abs(sum - witness.sum) > EPS) {
            return { status: 'INVALID', reason: 'MATH_CONTRADICTION' };
        }

        // Verify that the disjoint events represented by the marginals legitimately exceed 1.0
        // This O(k) operation proves the spatial bounds are topologically impossible under strict causal stopping.
        if (sum <= 1.0 + EPS) {
            return { status: 'INVALID', reason: 'MATH_CONTRADICTION' };
        }
        
        return { status: 'VALID', verifiedWitnessType: 'KRIPKE' };
    }

    return { status: 'INVALID', reason: 'MATH_CONTRADICTION' };
}
