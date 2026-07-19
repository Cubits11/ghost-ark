import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
    CgroupOrchestrator,
    type CgroupIdIpcPayload,
} from '../../../packages/containment-gateway/src/cgroupOrchestrator';
import { MockRing0EbpfLedgerDaemon } from '../../../packages/containment-gateway/src/ebpfMappingDaemon';

describe('Cgroup v2 Orchestrator & Ring-0 eBPF IPC Daemon', () => {
    let tmpDir: string;
    let socketPath: string;
    let daemon: MockRing0EbpfLedgerDaemon;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-ark-cgroup-test-'));
        socketPath = path.join(tmpDir, 'ebpf-daemon.sock');
        daemon = new MockRing0EbpfLedgerDaemon(socketPath);
        await daemon.start();
    });

    afterEach(async () => {
        await daemon.stop();
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('parses cgroup v2 path from procfs cgroup file', () => {
        const procDir = path.join(tmpDir, 'proc', '1234');
        fs.mkdirSync(procDir, { recursive: true });
        const cgroupContent = '0::/user.slice/user-1000.slice/ghost-ark-agent.slice/ghost-ark-agent-123.scope\n';
        fs.writeFileSync(path.join(procDir, 'cgroup'), cgroupContent, 'utf8');

        const orchestrator = new CgroupOrchestrator({
            procRoot: path.join(tmpDir, 'proc'),
        });

        const relPath = orchestrator.getCgroupRelativePath(1234);
        expect(relPath).toBe('user.slice/user-1000.slice/ghost-ark-agent.slice/ghost-ark-agent-123.scope');
    });

    it('enforces 0600 POSIX permissions on the IPC socket file', () => {
        const stat = fs.statSync(socketPath);
        const permissions = stat.mode & 0o777;
        expect(permissions).toBe(0o600);
    });

    it('extracts raw 64-bit inode (cgroup_id) from sysfs directory', () => {
        const procDir = path.join(tmpDir, 'proc', '5678');
        fs.mkdirSync(procDir, { recursive: true });

        const relCgroupPath = 'user.slice/ghost-ark-agent.slice/unit-test.scope';
        fs.writeFileSync(
            path.join(procDir, 'cgroup'),
            `0::/${relCgroupPath}\n`,
            'utf8',
        );

        const sysfsDir = path.join(tmpDir, 'sys', 'fs', 'cgroup', relCgroupPath);
        fs.mkdirSync(sysfsDir, { recursive: true });

        const sysfsStat = fs.statSync(sysfsDir, { bigint: true });
        const expectedIno = sysfsStat.ino.toString();

        const orchestrator = new CgroupOrchestrator({
            procRoot: path.join(tmpDir, 'proc'),
            cgroupSysfsRoot: path.join(tmpDir, 'sys', 'fs', 'cgroup'),
        });

        const cgroupId = orchestrator.getCgroupIdFromPid(5678);
        expect(cgroupId).toBe(expectedIno);
        expect(BigInt(cgroupId) > 0n).toBe(true);
    });

    it('registers 64-bit cgroup_id with eBPF Daemon over Unix socket IPC', async () => {
        const orchestrator = new CgroupOrchestrator({
            socketPath,
        });

        const payload: CgroupIdIpcPayload = {
            type: 'REGISTER_CGROUP_ID',
            cgroupId: '1439284729104829',
            pid: 9999,
            slice: 'ghost-ark-agent.slice',
            unitName: 'ghost-ark-agent-test.scope',
            timestamp: Date.now(),
        };

        const response = await orchestrator.registerCgroupIdWithDaemon(payload);

        expect(response.status).toBe('ACK');
        expect(response.cgroupId).toBe('1439284729104829');
        expect(response.injected).toBe(true);
        expect(response.ring0LedgerIndex).toBe(0);

        const ledger = daemon.getLedger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0].cgroupId).toBe('1439284729104829');
        expect(ledger[0].pid).toBe(9999);
        expect(ledger[0].status).toBe('ACTIVE');
    });

    it('spawns agent process with mock fallback and registers with daemon', async () => {
        const orchestrator = new CgroupOrchestrator({
            socketPath,
            useSystemdRun: false, // direct child process spawn for test portability
        });

        const mockCgroupId = '18446744073709551615';
        const result = await orchestrator.spawnAndRegister(
            'node',
            ['-e', 'console.log("agent running")'],
            {
                mockCgroupId,
                registerWithDaemon: true,
            },
        );

        expect(result.pid).toBeGreaterThan(0);
        expect(result.cgroupId).toBe(mockCgroupId);
        expect(result.ipcResponse?.status).toBe('ACK');
        expect(result.ipcResponse?.cgroupId).toBe(mockCgroupId);

        const entry = daemon.getEntryByCgroupId(mockCgroupId);
        expect(entry).toBeDefined();
        expect(entry?.pid).toBe(result.pid);

        if (result.childProcess) {
            result.childProcess.kill();
        }
    });
});
