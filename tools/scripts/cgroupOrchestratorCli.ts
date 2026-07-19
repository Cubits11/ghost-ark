#!/usr/bin/env ts-node
import { CgroupOrchestrator } from '../../packages/containment-gateway/src/cgroupOrchestrator';

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: cgroupOrchestratorCli [options] <command> [args...]

Options:
  --slice=<name>             Target cgroup v2 slice (default: ghost-ark-agent.slice)
  --socket=<path>            Path to Node IPC Unix Socket (default: /run/ghost-ark/ebpf-ledger.sock)
  --mock-cgroup-id=<id>      Mock 64-bit integer for non-Linux / test runs
  --no-systemd               Do not use systemd-run (spawn command directly)
  --help                     Show this help message
`);
        process.exit(0);
    }

    let slice = 'ghost-ark-agent.slice';
    let socketPath = '/run/ghost-ark/ebpf-ledger.sock';
    let mockCgroupId: string | undefined;
    let useSystemdRun = true;

    const commandArgs: string[] = [];

    for (const arg of args) {
        if (arg.startsWith('--slice=')) {
            slice = arg.split('=')[1];
        } else if (arg.startsWith('--socket=')) {
            socketPath = arg.split('=')[1];
        } else if (arg.startsWith('--mock-cgroup-id=')) {
            mockCgroupId = arg.split('=')[1];
        } else if (arg === '--no-systemd') {
            useSystemdRun = false;
        } else {
            commandArgs.push(arg);
        }
    }

    if (commandArgs.length === 0) {
        console.error('Error: No command specified to run inside cgroup scope.');
        process.exit(1);
    }

    const command = commandArgs[0];
    const cmdArgs = commandArgs.slice(1);

    const orchestrator = new CgroupOrchestrator({
        slice,
        socketPath,
        useSystemdRun,
    });

    console.log(`[CgroupOrchestrator] Spawning: ${command} ${cmdArgs.join(' ')}`);
    console.log(`[CgroupOrchestrator] Slice: ${slice}`);
    console.log(`[CgroupOrchestrator] IPC Socket: ${socketPath}`);

    try {
        const result = await orchestrator.spawnAndRegister(command, cmdArgs, {
            mockCgroupId: mockCgroupId ?? (process.platform === 'linux' ? undefined : '18446744073709551615'),
            registerWithDaemon: true,
        });

        console.log(`[CgroupOrchestrator] Agent PID: ${result.pid}`);
        console.log(`[CgroupOrchestrator] Unit Name: ${result.unitName}`);
        console.log(`[CgroupOrchestrator] Raw 64-bit cgroup_id Inode: ${result.cgroupId}`);
        console.log(`[CgroupOrchestrator] IPC Daemon Response:`, JSON.stringify(result.ipcResponse));
    } catch (err: any) {
        console.error(`[CgroupOrchestrator] Execution failed: ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
