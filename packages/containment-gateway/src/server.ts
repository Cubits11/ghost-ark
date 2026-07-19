import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import {
    ScopedMutationGate,
    type MutationVerdict,
} from '../../research-frontier/src/containment/scopedMutationGate';

/**
 * Egress gateway: an HTTP front for ScopedMutationGate. An untrusted agent's
 * "tool call" arrives as JSON on POST /rpc/v1/agent-exec; the gateway routes it
 * through the containment triad (scope allowlist -> numeric bounds -> OCC) and
 * returns the verdict plus an unsigned digest receipt.
 *
 * Boundary: zero-dependency, single Node process. Node is single-threaded, so
 * concurrent requests interleave on the event loop - there is no OS-thread data
 * race to defend against here. What this DOES enforce under concurrency is the
 * OCC no-lost-update guarantee: two requests that both read a key and then both
 * try to write it cannot both win; the stale one aborts. This is not kernel
 * isolation and does not sandbox code execution.
 */

export interface AgentExecRequest {
    agentId?: string;
    resource: string;
    operation: string;
    value?: unknown;
    /** Numeric risk vector checked against the policy's convex bounds, if any. */
    boundVector?: number[];
}

export interface GatewayResult {
    httpStatus: number;
    body: {
        verdict: MutationVerdict;
        ledgerChanged: boolean;
        receipt: string; // unsigned SHA-256 content digest (digestHex)
        status?: string;
        error?: string;
    };
}

const HTTP_STATUS: Record<MutationVerdict, number> = {
    COMMITTED: 200,
    REFUSED_OUT_OF_SCOPE: 403,
    REFUSED_BOUND_BREACH: 403,
    ABORT_TEMPORAL_DRIFT: 409,
};

const ERROR_CODE: Record<Exclude<MutationVerdict, 'COMMITTED'>, string> = {
    REFUSED_OUT_OF_SCOPE: 'SCOPE_VIOLATION',
    REFUSED_BOUND_BREACH: 'BOUND_BREACH',
    ABORT_TEMPORAL_DRIFT: 'TEMPORAL_DRIFT_ABORT',
};

/**
 * Socket-free evaluation core. Two-phase (begin -> await gap -> commit) so that
 * concurrent same-resource requests genuinely capture their read snapshots
 * before any of them commits; `beforeCommit` models the async work a real
 * gateway does in that window (policy fetch, model call) and is the seam tests
 * use to make contention deterministic. Default is a macrotask yield.
 */
export async function handleAgentExec(
    gate: ScopedMutationGate,
    req: AgentExecRequest,
    beforeCommit: () => Promise<void> = () => new Promise((r) => setImmediate(r)),
): Promise<GatewayResult> {
    const agentId = req.agentId ?? 'anonymous-agent';
    const agent = gate.begin(agentId, req.resource);
    await beforeCommit();
    const receipt = gate.commit(agent, {
        resource: req.resource,
        operation: req.operation,
        value: req.value ?? { op: req.operation },
        boundVector: req.boundVector,
    });

    const body: GatewayResult['body'] = {
        verdict: receipt.verdict,
        ledgerChanged: receipt.ledgerChanged,
        receipt: receipt.digestHex,
    };
    if (receipt.verdict === 'COMMITTED') {
        body.status = 'COMMITTED';
    } else {
        body.error = ERROR_CODE[receipt.verdict];
    }
    return { httpStatus: HTTP_STATUS[receipt.verdict], body };
}

export interface GatewayOptions {
    /** Async gap between read and commit; default is a setImmediate yield. */
    beforeCommit?: () => Promise<void>;
}

export function createGatewayServer(gate: ScopedMutationGate, opts: GatewayOptions = {}): Server {
    const beforeCommit = opts.beforeCommit;
    return createServer((httpReq: IncomingMessage, res: ServerResponse) => {
        if (httpReq.method !== 'POST' || httpReq.url !== '/rpc/v1/agent-exec') {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'NOT_FOUND' }));
            return;
        }
        let raw = '';
        httpReq.on('data', (chunk) => {
            raw += chunk;
        });
        httpReq.on('end', () => {
            let parsed: any;
            try {
                parsed = JSON.parse(raw || '{}');
            } catch {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON body' }));
                return;
            }
            const req: AgentExecRequest = {
                agentId: parsed.agentId,
                resource: parsed.resource,
                operation: parsed.operation,
                value: parsed.value,
                // accept `bounds` as an alias for boundVector (external tool-call shape)
                boundVector: parsed.boundVector ?? parsed.bounds,
            };
            handleAgentExec(gate, req, beforeCommit)
                .then((result) => {
                    res.writeHead(result.httpStatus, { 'content-type': 'application/json' });
                    res.end(JSON.stringify(result.body));
                })
                .catch((err) => {
                    res.writeHead(500, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ error: 'GATEWAY_ERROR', message: err?.message ?? 'unknown' }));
                });
        });
    });
}
