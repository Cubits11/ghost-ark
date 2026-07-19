import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

export interface CgroupOrchestratorOptions {
    slice?: string;
    socketPath?: string;
    cgroupSysfsRoot?: string;
    procRoot?: string;
    unitPrefix?: string;
    useSystemdRun?: boolean;
}

export interface CgroupIdIpcPayload {
    type: 'REGISTER_CGROUP_ID';
    command?: 'REGISTER' | 'REVOKE' | 'QUERY';
    cgroupId: string; // 64-bit uint represented as decimal string
    pid: number;
    slice: string;
    unitName: string;
    timestamp: number;
}

export interface CgroupIpcResponse {
    status: 'ACK' | 'NACK' | 'ERROR';
    cgroupId: string;
    injected?: boolean;
    ring0LedgerIndex?: number;
    stateDigest?: string;
    reason?: string;
    error?: string;
}

export interface SpawnedAgentResult {
    pid: number;
    unitName: string;
    slice: string;
    cgroupId: string;
    childProcess?: ChildProcess;
    ipcResponse?: CgroupIpcResponse;
}

export class CgroupOrchestrator {
    private slice: string;
    private socketPath: string;
    private cgroupSysfsRoot: string;
    private procRoot: string;
    private unitPrefix: string;
    private useSystemdRun: boolean;

    constructor(options: CgroupOrchestratorOptions = {}) {
        this.slice = options.slice ?? 'ghost-ark-agent.slice';
        this.socketPath = options.socketPath ?? '/run/ghost-ark/ebpf-ledger.sock';
        this.cgroupSysfsRoot = options.cgroupSysfsRoot ?? '/sys/fs/cgroup';
        this.procRoot = options.procRoot ?? '/proc';
        this.unitPrefix = options.unitPrefix ?? 'ghost-ark-agent';
        this.useSystemdRun = options.useSystemdRun ?? true;
    }

    /**
     * Resolves the relative cgroup v2 path for a given PID from procfs (/proc/<pid>/cgroup).
     */
    public getCgroupRelativePath(pid: number): string {
        const procCgroupFile = path.join(this.procRoot, String(pid), 'cgroup');
        if (!fs.existsSync(procCgroupFile)) {
            throw new Error(`Process cgroup file not found: ${procCgroupFile}`);
        }

        const content = fs.readFileSync(procCgroupFile, 'utf8');
        // cgroup v2 format line: "0::<relative_path>"
        for (const line of content.split('\n')) {
            const parts = line.split(':');
            if (parts.length >= 3 && (parts[0] === '0' || parts[1] === '')) {
                const relPath = parts[2].trim();
                return relPath.startsWith('/') ? relPath.substring(1) : relPath;
            }
        }
        throw new Error(`Could not parse cgroup v2 entry from ${procCgroupFile}`);
    }

    /**
     * Obtains the exact 64-bit inode number (`cgroup_id`) of the cgroup v2 slice directory.
     */
    public getCgroupIdFromPid(pid: number, mockFallbackId?: string): string {
        try {
            const relPath = this.getCgroupRelativePath(pid);
            const fullCgroupPath = path.join(this.cgroupSysfsRoot, relPath);

            if (fs.existsSync(fullCgroupPath)) {
                const stat = fs.statSync(fullCgroupPath, { bigint: true });
                return stat.ino.toString();
            }
        } catch (err) {
            if (mockFallbackId) {
                return mockFallbackId;
            }
            throw err;
        }

        if (mockFallbackId) {
            return mockFallbackId;
        }

        throw new Error(`cgroup sysfs path not found for PID ${pid}`);
    }

    /**
     * Transmits the 64-bit cgroup_id to the Node IPC Unix Domain Socket.
     */
    public async registerCgroupIdWithDaemon(
        payload: CgroupIdIpcPayload,
        socketPathOverride?: string,
    ): Promise<CgroupIpcResponse> {
        const targetSocket = socketPathOverride ?? this.socketPath;
        return new Promise((resolve, reject) => {
            const client = net.createConnection(targetSocket, () => {
                client.write(JSON.stringify(payload) + '\n');
            });

            let responseData = '';
            client.on('data', (chunk) => {
                responseData += chunk.toString('utf8');
                if (responseData.includes('\n')) {
                    client.end();
                }
            });

            client.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData.trim());
                    resolve(parsed as CgroupIpcResponse);
                } catch (err: any) {
                    reject(new Error(`Failed to parse IPC daemon response: ${err.message}`));
                }
            });

            client.on('error', (err) => {
                reject(new Error(`IPC Socket communication error (${targetSocket}): ${err.message}`));
            });
        });
    }

    /**
     * Spawns an untrusted payload inside a systemd transient scope under `ghost-ark-agent.slice`,
     * inspects its 64-bit cgroup_id inode, and registers it with the IPC Daemon.
     */
    public async spawnAndRegister(
        command: string,
        args: string[] = [],
        options: {
            mockCgroupId?: string;
            registerWithDaemon?: boolean;
            spawnAsync?: boolean;
        } = {},
    ): Promise<SpawnedAgentResult> {
        const randomId = Math.floor(Math.random() * 100000);
        const unitName = `${this.unitPrefix}-${Date.now()}-${randomId}.scope`;
        const shouldRegister = options.registerWithDaemon ?? true;

        let spawnCmd = command;
        let spawnArgs = args;

        if (this.useSystemdRun) {
            spawnCmd = 'systemd-run';
            spawnArgs = [
                '--user',
                '--scope',
                `--slice=${this.slice}`,
                `--unit=${unitName}`,
                '--uid=1001',
                '--gid=1001',
                '--',
                command,
                ...args,
            ];
        }

        const child = spawn(spawnCmd, spawnArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        if (!child.pid) {
            throw new Error(`Failed to spawn child process for command: ${command}`);
        }

        const pid = child.pid;
        let cgroupId: string;

        try {
            cgroupId = this.getCgroupIdFromPid(pid, options.mockCgroupId);
        } catch (err: any) {
            if (options.mockCgroupId) {
                cgroupId = options.mockCgroupId;
            } else {
                child.kill();
                throw new Error(`Failed to retrieve cgroup_id for PID ${pid}: ${err.message}`);
            }
        }

        const result: SpawnedAgentResult = {
            pid,
            unitName,
            slice: this.slice,
            cgroupId,
            childProcess: child,
        };

        if (shouldRegister) {
            const ipcPayload: CgroupIdIpcPayload = {
                type: 'REGISTER_CGROUP_ID',
                cgroupId,
                pid,
                slice: this.slice,
                unitName,
                timestamp: Date.now(),
            };

            const response = await this.registerCgroupIdWithDaemon(ipcPayload);
            result.ipcResponse = response;
        }

        return result;
    }
}
