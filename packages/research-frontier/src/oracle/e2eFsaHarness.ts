import * as net from 'net';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Receipt {
    receipt_id: string;
    tenant_id_hash: string;
    input_digest: string;
    execution_context_hash: string;
    policy_hash: string;
    nonce: string;
    execution_trace: { sequence_num: number; action: string }[];
    digest_binding: {
        response_payload_digest: string;
    };
    hmac?: string; // Appended by seal mechanism
}

export interface Scenario {
    id: string;
    honest: boolean;
    tamper?: boolean;
    requestBody: string;
    responseBody: string;
    trailingBytes?: string;
}

export interface HarnessOutcome {
    sequence_num: number;
    receiptValid: boolean;
    status: 'MATCH' | 'EXTRA_WIRE_BYTES' | 'DIVERGENT';
}

export interface ManifestReport {
    corpus_version: string;
    epsilon_threshold: number;
    confidence_label: string;
    m_estimate: {
        execution_count: number;
        receiptValidTotal: number;
        unsafeAmongValid: number;
        pointEstimate: number;
        lowerBound: number;
        upperBound: number;
    };
    reconciliation_summary: HarnessOutcome[];
    sealing_mode?: string;
    signature?: string;
}

export const DEV_HMAC_SECRET = 'local-dev-fsa-secret-2026';

// Reusable determinism simulation matching repo hashCanonicalization.ts behavior.
function signObjectHmac(obj: any, secret: string, includeHmacField = false): string {
    const copy = { ...obj };
    if (!includeHmacField) {
        delete copy.hmac;
        delete copy.signature;
    }
    // Ensures baseline determinism
    const canonical = JSON.stringify(copy, Object.keys(copy).sort());
    return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

export function localDevVerify(receipt: Receipt): boolean {
    const expected = signObjectHmac(receipt, DEV_HMAC_SECRET);
    return receipt.hmac === expected;
}

export function verifyReportSeal(report: ManifestReport): boolean {
    if (report.sealing_mode !== 'LOCAL_HMAC_SHA256_DEV_ONLY') return false;
    const expected = signObjectHmac(report, DEV_HMAC_SECRET);
    return report.signature === expected;
}

// 95% Wilson Score CI calculation 
function wilsonScoreInterval(k: number, n: number, z = 1.96) {
    if (n === 0) return { lower: 0, upper: 0, estimate: 0 };
    const p = k / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = p + z2 / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return {
        lower: (center - spread) / denominator,
        upper: (center + spread) / denominator,
        estimate: p
    };
}

// Builds the V2 test trace elements for simulating the sidecar's governed invoke logic
function buildAndSignReceipt(scenario: Scenario, sequenceNum: number): Receipt {
    const digest = crypto.createHash('sha256').update(scenario.responseBody).digest('hex');
    
    const receipt: Receipt = {
        receipt_id: `rcpt_${crypto.randomUUID()}`,
        tenant_id_hash: crypto.createHash('sha256').update('test-tenant').digest('hex'),
        input_digest: crypto.createHash('sha256').update(scenario.requestBody).digest('hex'),
        execution_context_hash: crypto.createHash('sha256').update('context-FSA').digest('hex'),
        policy_hash: crypto.createHash('sha256').update('strict-default').digest('hex'),
        nonce: `e2e-nonce-000${sequenceNum}`,
        execution_trace: [{ sequence_num: sequenceNum, action: 'governedInvoke' }],
        digest_binding: { response_payload_digest: digest }
    };

    if (scenario.tamper) {
        // Break identity bindings cleanly - honest hash computed during sig, altered after.
        receipt.hmac = signObjectHmac(receipt, DEV_HMAC_SECRET);
        receipt.digest_binding.response_payload_digest = 'a'.repeat(64);
    } else {
        receipt.hmac = signObjectHmac(receipt, DEV_HMAC_SECRET);
    }
    
    return receipt;
}

// Emulate reconciling logic directly targeting the wire string properties and Content-Length bindings 
function reconcile(receipt: Receipt, observationWire: Buffer): 'MATCH' | 'EXTRA_WIRE_BYTES' | 'DIVERGENT' {
    const rawString = observationWire.toString('utf8');
    const headerTerminatorIndex = rawString.indexOf('\r\n\r\n');
    if (headerTerminatorIndex === -1) return 'DIVERGENT';
    
    const headersStr = rawString.substring(0, headerTerminatorIndex);
    const wireBodyData = observationWire.subarray(headerTerminatorIndex + 4);
    
    const match = headersStr.match(/Content-Length:\s*(\d+)/i);
    const expectedLength = match ? parseInt(match[1], 10) : wireBodyData.length;
    
    const trueBodyStr = wireBodyData.subarray(0, expectedLength).toString('utf8');
    const wireBodyDigest = crypto.createHash('sha256').update(trueBodyStr).digest('hex');
    
    if (receipt.digest_binding.response_payload_digest !== wireBodyDigest) {
        return 'DIVERGENT';
    }
    
    // We detected bytes downstream over wire exceeding receipt's strict frame bound
    if (wireBodyData.length > expectedLength) {
        return 'EXTRA_WIRE_BYTES';
    }
    return 'MATCH';
}

function performGatewayRequest(proxyPort: number, reqBody: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: proxyPort,
            method: 'POST',
            path: '/',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqBody),
                'Connection': 'close' 
            }
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.write(reqBody);
        req.end();
    });
}

// Recreate default payload structure (5 honest, 2 smuggling/pipelined trailing bytes, 1 tamper exclusion validation)
const scenarios: Scenario[] = [
    { id: 'H1', honest: true, requestBody: '{"action": "info"}', responseBody: '{"ok": true}' },
    { id: 'H2', honest: true, requestBody: '{"action": "ping"}', responseBody: '{"pong": true}' },
    { id: 'S1', honest: false, requestBody: '{"action": "exploit"}', responseBody: '{"ok": true}', trailingBytes: 'EXTRA_TRAILER_GARBAGE' },
    { id: 'H3', honest: true, requestBody: '{"action": "echo"}', responseBody: '{"echo": 1}' },
    { id: 'S2', honest: false, requestBody: '{"action": "pipe"}', responseBody: '{"ok": true}', trailingBytes: '\r\nGET /internal HTTP/1.1\r\n\r\n' },
    { id: 'H4', honest: true, requestBody: '{"action": "run"}', responseBody: '{"res": "yes"}' },
    { id: 'T1', honest: true, tamper: true, requestBody: '{"action": "mutated"}', responseBody: '{"status": 200}' },
    { id: 'H5', honest: true, requestBody: '{"action": "fini"}', responseBody: '{"done": 1}' },
];

export async function executeHarness(options: { verifier?: (r: Receipt) => boolean } = {}) {
    const verifier = options.verifier ?? localDevVerify;
    const observations = new Map<number, Buffer>();
    let transitCounter = 0;
    
    const targetServer = net.createServer((socket) => {
        socket.once('data', () => {
            const scenario = scenarios[transitCounter];
            const payload = scenario.responseBody;
            
            let wireString = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n${payload}`;
            if (scenario.trailingBytes) wireString += scenario.trailingBytes;
            
            socket.write(wireString);
            socket.end();
        });
    });

    let proxyPort = 0, targetPort = 0;

    await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as net.AddressInfo).port;
        resolve();
    }));

    const proxyServer = net.createServer((clientSocket) => {
        let recordedBytes = Buffer.alloc(0);
        const seq = transitCounter; // captures state strictly sequentially
        
        const targetSocket = net.connect(targetPort, '127.0.0.1', () => clientSocket.pipe(targetSocket));
        
        targetSocket.on('data', (chunk) => {
            recordedBytes = Buffer.concat([recordedBytes, chunk]);
            clientSocket.write(chunk);
        });
        
        targetSocket.on('end', () => {
            clientSocket.end();
            observations.set(seq, recordedBytes);
        });

        clientSocket.on('error', () => targetSocket.destroy());
        targetSocket.on('error', () => clientSocket.destroy());
    });

    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', () => {
        proxyPort = (proxyServer.address() as net.AddressInfo).port;
        resolve();
    }));

    const outcomes: HarnessOutcome[] = [];

    try {
        for (let i = 0; i < scenarios.length; i++) {
            transitCounter = i;
            const scenario = scenarios[i];
            
            // Await execution cycle completion
            await performGatewayRequest(proxyPort, scenario.requestBody);
            
            // Allow asynchronous intercept propagation to stabilize wire captures locally
            await new Promise(r => setTimeout(r, 20));
            
            const obsWire = observations.get(i)!;
            const receipt = buildAndSignReceipt(scenario, i);
            
            const receiptValid = verifier(receipt);
            const status = receiptValid ? reconcile(receipt, obsWire) : 'DIVERGENT';
            
            outcomes.push({ sequence_num: i, receiptValid, status });
        }
    } finally {
        await new Promise(r => targetServer.close(r));
        await new Promise(r => proxyServer.close(r));
    }

    // Tabulate exclusions and strict bounds
    const receiptValidTotal = outcomes.filter(o => o.receiptValid).length; 
    const unsafeAmongValid = outcomes.filter(o => o.receiptValid && o.status === 'EXTRA_WIRE_BYTES').length; 
    
    const ci = wilsonScoreInterval(unsafeAmongValid, receiptValidTotal);
    
    const coreReport: ManifestReport = {
        corpus_version: "v1.2.0-FSA",
        epsilon_threshold: 0.01, // System constraint definition
        confidence_label: "95%",
        m_estimate: {
            execution_count: outcomes.length,
            receiptValidTotal,
            unsafeAmongValid,
            pointEstimate: ci.estimate,
            lowerBound: ci.lower,
            upperBound: ci.upper
        },
        reconciliation_summary: outcomes
    };
    
    const report: ManifestReport = {
        ...coreReport,
        sealing_mode: 'LOCAL_HMAC_SHA256_DEV_ONLY',
        signature: signObjectHmac(coreReport, DEV_HMAC_SECRET)
    };

    // Serialize outputs mimicking robust framework
    const artifactDir = path.join(process.cwd(), 'artifacts');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, 'local_m_report_v1.json'), JSON.stringify(report, null, 2), 'utf-8');

    return report;
}