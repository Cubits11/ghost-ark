#!/usr/bin/env bash
# ==============================================================================
# Ghost-Ark Cgroup v2 Agent Process Orchestrator
# ==============================================================================
# Encapsulates an untrusted agent runtime inside a systemd transient scope under
# ghost-ark-agent.slice, extracts its 64-bit cgroup_id inode from /sys/fs/cgroup,
# and pipes the integer payload into the Ghost-Ark Daemon Unix IPC socket.
# ==============================================================================

set -euo pipefail

SLICE_NAME="${GHOST_ARK_SLICE:-ghost-ark-agent.slice}"
SOCKET_PATH="${GHOST_ARK_IPC_SOCKET:-/run/ghost-ark/ebpf-ledger.sock}"
CGROUP_FS="${GHOST_ARK_CGROUP_FS:-/sys/fs/cgroup}"
MOCK_CGROUP_ID="${GHOST_ARK_MOCK_CGROUP_ID:-18446744073709551615}"

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <command> [args...]"
    echo "Example: $0 python rogue_agent.py"
    exit 1
fi

PAYLOAD_CMD=("$@")
UNIT_NAME="ghost-ark-agent-$(date +%s)-$RANDOM"

echo "[Ghost-Ark Orchestrator] Target Slice: ${SLICE_NAME}"
echo "[Ghost-Ark Orchestrator] Transient Scope Unit: ${UNIT_NAME}"
echo "[Ghost-Ark Orchestrator] IPC Socket: ${SOCKET_PATH}"

# Check if running under Linux with systemd
if command -v systemd-run >/dev/null 2>&1 && [ -d "${CGROUP_FS}" ]; then
    echo "[Ghost-Ark Orchestrator] Launching via systemd-run --scope..."
    
    # Run payload in scope
    systemd-run --user --scope "--slice=${SLICE_NAME}" "--unit=${UNIT_NAME}" --uid=1001 --gid=1001 -- "${PAYLOAD_CMD[@]}" &
    PID=$!

    # Wait for process cgroup entry to populate
    sleep 0.1
    
    if [ -f "/proc/${PID}/cgroup" ]; then
        REL_PATH=$(grep -E '^[0-9]+:' "/proc/${PID}/cgroup" | head -n1 | cut -d: -f3 | sed 's|^/||')
        FULL_CGROUP_PATH="${CGROUP_FS}/${REL_PATH}"
        
        if [ -d "${FULL_CGROUP_PATH}" ]; then
            RAW_CGROUP_ID=$(stat -c %i "${FULL_CGROUP_PATH}")
            echo "[Ghost-Ark Orchestrator] Extracted cgroup_id Inode: ${RAW_CGROUP_ID}"
        else
            echo "[Ghost-Ark Orchestrator] Notice: cgroup path ${FULL_CGROUP_PATH} not accessible, using fallback ID."
            RAW_CGROUP_ID="${MOCK_CGROUP_ID}"
        fi
    else
        RAW_CGROUP_ID="${MOCK_CGROUP_ID}"
    fi

    TIMESTAMP=$(date +%s000)
    JSON_PAYLOAD=$(cat <<EOF
{"type":"REGISTER_CGROUP_ID","cgroupId":"${RAW_CGROUP_ID}","pid":${PID},"slice":"${SLICE_NAME}","unitName":"${UNIT_NAME}","timestamp":${TIMESTAMP}}
EOF
    )

    if command -v nc >/dev/null 2>&1 && [ -S "${SOCKET_PATH}" ]; then
        echo "[Ghost-Ark Orchestrator] Piping payload into Unix socket ${SOCKET_PATH}..."
        echo "${JSON_PAYLOAD}" | nc -U "${SOCKET_PATH}"
    else
        echo "[Ghost-Ark Orchestrator] Falling back to Node orchestrator CLI for IPC socket..."
        npx ts-node tools/scripts/cgroupOrchestratorCli.ts --slice="${SLICE_NAME}" --socket="${SOCKET_PATH}" --mock-cgroup-id="${RAW_CGROUP_ID}" --no-systemd "${PAYLOAD_CMD[@]}"
    fi

    wait "${PID}" 2>/dev/null || true
else
    echo "[Ghost-Ark Orchestrator] Non-systemd / fallback environment detected. Delegating to Node Orchestrator..."
    npx ts-node tools/scripts/cgroupOrchestratorCli.ts --slice="${SLICE_NAME}" --socket="${SOCKET_PATH}" --mock-cgroup-id="${MOCK_CGROUP_ID}" --no-systemd "${PAYLOAD_CMD[@]}"
fi
