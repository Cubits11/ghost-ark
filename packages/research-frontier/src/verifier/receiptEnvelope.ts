import { CommitReceipt, AbortReceipt } from '../occ/ghostReplica';

/**
 * The cryptographic envelope wrapping all outputs of the Ghost-Ark OCC Gate.
 * This ensures stateless refutability without re-running heavy LP oracles.
 * 
 * WARNING: Uses DEV-HMAC. Does NOT yet use ML-DSA-65 post-quantum cryptography.
 */
export interface ReceiptEnvelope<T extends CommitReceipt | AbortReceipt> {
    /**
     * MUST contain the exact string "[SYNTH_ONLY: DEV-HMAC]" to satisfy claim scanners
     * and strictly document the current state of cryptographic maturity.
     */
    cryptoHeader: string;
    
    /**
     * Unique identifier for the bounded evaluation session.
     */
    transactionId: string;
    
    /**
     * The timestamp of speculative execution.
     */
    timestampIso: string;
    
    /**
     * The physical telemetry of the OCC computation.
     */
    telemetry: {
        marginals: number[];
        iterationBudgetSpent: number;
        empiricalTrace?: boolean[]; // Traces constraint boolean firings for Phi calculation
    };
    
    /**
     * The actual outcome of the OCC Gate.
     * Can be a CommitReceipt, or an AbortReceipt (carrying Kripke countermodels or Chaitin aborts).
     */
    payload: T;
    
    /**
     * SHA-256 HMAC of the serialized payload using the SYNTH_ONLY development key.
     */
    signature: string;
}

export interface KripkeCountermodel {
    type: 'KripkeModel';
    world: string;
    // To statelessly verify Fréchet violations, the model must carry the exact sum
    // that mathematically proves the configuration is topologically impossible.
    marginals: number[];
    sum: number;
}

export interface ChaitinGeneratorWitness {
    type: 'ChaitinGenerator';
    payload: string;
    bytes: number;
    iterationsExhausted: number;
}
