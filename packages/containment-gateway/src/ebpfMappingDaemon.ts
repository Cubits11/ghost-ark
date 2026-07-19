import * as fs from 'node:fs';
import * as net from 'node:net';
import {
    type CgroupIdIpcPayload,
    type CgroupIpcResponse,
} from './cgroupOrchestrator';

export type { CgroupIdIpcPayload, CgroupIpcResponse };

export interface EbpfLedgerEntry {
    cgroupId: string;
    pid: number;
    slice?: string;
    unitName?: string;
    timestamp?: number;
    status: 'ACTIVE' | 'REVOKED';
    registeredAt: number;
}

/**
 * MockRing0EbpfLedgerDaemon
 * Provides a streaming Unix domain socket interface for testing cgroup
 * socket registrations with frame boundary handling and in-memory ledger state.
 */
export class MockRing0EbpfLedgerDaemon {
    private socketPath: string;
    private server: net.Server | null = null;
    private ledger: EbpfLedgerEntry[] = [];
    private authorizedCgroups: Set<string> = new Set();

    constructor(socketPath: string = '/tmp/ghost_ark_ring0.sock') {
        this.socketPath = socketPath;
    }

    public async start(): Promise<void> {
        if (fs.existsSync(this.socketPath)) {
            fs.rmSync(this.socketPath, { force: true });
        }

        return new Promise((resolve, reject) => {
            this.server = net.createServer((client) => this.handleClient(client));

            this.server.on('error', (err) => {
                reject(err);
            });

            this.server.listen(this.socketPath, () => {
                try {
                    fs.chmodSync(this.socketPath, 0o600);
                } catch {
                    // Ignore on platforms without Unix socket permission support
                }
                resolve();
            });
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                if (fs.existsSync(this.socketPath)) {
                    fs.rmSync(this.socketPath, { force: true });
                }
                return resolve();
            }

            this.server.close(() => {
                this.server = null;
                if (fs.existsSync(this.socketPath)) {
                    fs.rmSync(this.socketPath, { force: true });
                }
                resolve();
            });
        });
    }

    private handleClient(client: net.Socket) {
        let buffer = '';

        client.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const frame = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 1);
                if (frame.trim()) {
                    this.processFrame(frame, client);
                }
                boundary = buffer.indexOf('\n');
            }
        });

        client.on('error', () => {
            // Socket stream error handler
        });
    }

    private processFrame(frame: string, client: net.Socket) {
        try {
            const payload = JSON.parse(frame) as CgroupIdIpcPayload;
            const isRegister =
                payload.type === 'REGISTER_CGROUP_ID' ||
                payload.command === 'REGISTER';

            if (isRegister && payload.cgroupId) {
                const cgroupId = String(payload.cgroupId);
                this.authorizedCgroups.add(cgroupId);
                const entry: EbpfLedgerEntry = {
                    cgroupId,
                    pid: Number(payload.pid ?? 0),
                    slice: payload.slice,
                    unitName: payload.unitName,
                    timestamp: payload.timestamp,
                    status: 'ACTIVE',
                    registeredAt: Date.now(),
                };
                this.ledger.push(entry);
                const ring0LedgerIndex = this.ledger.length - 1;

                const response: CgroupIpcResponse = {
                    status: 'ACK',
                    cgroupId,
                    injected: true,
                    ring0LedgerIndex,
                    stateDigest: this.generateDigest(),
                };
                client.write(JSON.stringify(response) + '\n');
            } else {
                const response: CgroupIpcResponse = {
                    status: 'NACK',
                    cgroupId: payload.cgroupId || 'UNKNOWN',
                    reason: 'Invalid command or missing cgroupId',
                };
                client.write(JSON.stringify(response) + '\n');
            }
        } catch (e: any) {
            client.write(
                JSON.stringify({
                    status: 'NACK',
                    cgroupId: 'UNKNOWN',
                    reason: 'Malformed JSON',
                    error: e.message,
                }) + '\n',
            );
        }
    }

    private generateDigest(): string {
        return `sha256:${Buffer.from(Array.from(this.authorizedCgroups).join(',')).toString('base64')}`;
    }

    public isAuthorized(cgroupId: string): boolean {
        return this.authorizedCgroups.has(cgroupId);
    }

    public getLedger(): EbpfLedgerEntry[] {
        return [...this.ledger];
    }

    public getEntryByCgroupId(cgroupId: string): EbpfLedgerEntry | undefined {
        return this.ledger.find((e) => e.cgroupId === cgroupId);
    }
}
