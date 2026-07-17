import { verifyEnvelope } from '../verifier/statelessVerifier';
import { ReceiptEnvelope } from '../verifier/receiptEnvelope';
import { CommitReceipt, AbortReceipt } from '../occ/ghostReplica';

export class CcCohortLedger {
    private traces: boolean[][] = [];
    private devKey: string;

    constructor(devKey: string) {
        this.devKey = devKey;
    }

    /**
     * Ingests an envelope, strictly enforcing O(1) mathematical verification.
     * Throws violently if unverified, preventing cohort contamination.
     */
    public ingest<T extends CommitReceipt | AbortReceipt>(envelope: ReceiptEnvelope<T>): void {
        const result = verifyEnvelope(envelope, this.devKey);
        
        if (result.status === 'INVALID') {
            throw new Error(`UNVERIFIED_COHORT_CONTAMINATION: Envelope cryptographic or refutation proof failed. Reason: ${result.reason}`);
        }

        if (envelope.telemetry.empiricalTrace) {
            this.traces.push(envelope.telemetry.empiricalTrace);
        }
    }

    /**
     * Calculates the Pearson Phi correlation coefficient between two guardrail indices.
     * Over a sufficiently large cohort, this empirically shreds "defense-in-depth"
     * assumptions by proving that semantic guardrail bypasses are highly correlated.
     */
    public computePhi(i: number, j: number): number {
        const n = this.traces.length;
        if (n === 0) return 0;

        let f11 = 0, f10 = 0, f01 = 0, f00 = 0;

        for (const trace of this.traces) {
            const fi = trace[i] ? 1 : 0;
            const fj = trace[j] ? 1 : 0;

            if (fi === 1 && fj === 1) f11++;
            else if (fi === 1 && fj === 0) f10++;
            else if (fi === 0 && fj === 1) f01++;
            else if (fi === 0 && fj === 0) f00++;
        }

        const num = (f11 * f00) - (f10 * f01);
        const den2 = (f11 + f10) * (f01 + f00) * (f11 + f01) * (f10 + f00);
        
        if (den2 === 0) {
            // Undefined correlation if variance is zero (a guardrail literally never fires)
            return 0;
        }

        return num / Math.sqrt(den2);
    }

    /**
     * Verifies that the empirical union of failures bounded by the cohort
     * does not exceed the theoretical max union calculated by the LP Oracle.
     */
    public verifyCohortBounds(oracleMaxUnion: number): boolean {
        const n = this.traces.length;
        if (n === 0) return true;

        let unionCount = 0;
        for (const trace of this.traces) {
            // A union event occurs if *any* evaluated constraint tripped
            if (trace.some(bit => bit)) {
                unionCount++;
            }
        }

        const empiricalUnion = unionCount / n;
        
        // Strict evaluation with floating-point drift allowance
        const EPS = 1e-9;
        return empiricalUnion <= oracleMaxUnion + EPS;
    }
}
