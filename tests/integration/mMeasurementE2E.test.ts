import { 
    executeHarness, 
    verifyReportSeal, 
    localDevVerify 
} from '../../packages/research-frontier/src/oracle/e2eFsaHarness';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mimics a robust runner check logic that you run over 'yarn test'
describe('Oracle Measurement Gateway Topology integration (M Phase III)', () => {
    
    it('correlates serialized traces honestly & computes falsified constraints properly via bounds', async () => {
        // Dependency inject standard DEV Verifier mimicking production execution patterns.
        const report = await executeHarness({ verifier: localDevVerify });

        expect(report).toBeDefined();
        
        // Excludes Tampered Signature payload efficiently
        expect(report.m_estimate.execution_count).toBe(8);
        expect(report.m_estimate.receiptValidTotal).toBe(7); 
        expect(report.m_estimate.unsafeAmongValid).toBe(2);
        
        const M_bound = report.m_estimate.lowerBound;
        const eps = report.epsilon_threshold;
        
        expect(typeof M_bound).toBe('number');
        // Bounds verification checking mathematical significance vs required FSA boundaries
        const strictlyFalsified = M_bound > eps;
        expect(strictlyFalsified).toBe(true);
        
        const tamperSummary = report.reconciliation_summary.find(o => o.sequence_num === 6); // Test Sequence mapping "T1"
        expect(tamperSummary?.receiptValid).toBe(false);

        const smugglingSummaries = report.reconciliation_summary.filter(o => o.status === 'EXTRA_WIRE_BYTES');
        expect(smugglingSummaries).toHaveLength(2);

        // Sanity confirm sealed disk outputs to catch tampering assertions 
        const filePath = path.join(process.cwd(), 'artifacts', 'local_m_report_v1.json');
        const writtenContents = JSON.parse(await fs.readFile(filePath, 'utf8'));

        expect(writtenContents.signature).toBe(report.signature);
        expect(verifyReportSeal(writtenContents)).toBe(true);
    });

});