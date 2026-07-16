#!/usr/bin/env bash
#
# Ghost-Ark DAB Tier-0 — end-to-end over the REAL Unix-domain socket.
#
# Unlike run_roundtrip.sh (which uses the hermetic emit-receipt mode), this
# drives the full running gateway through /ipc/dab.sock with a real agent
# client, exercising: the wired tombstone ReplayLedger (replay rejection across
# two socket calls), the C_I==C_E mutation halt, and the certified path
# (gateway posts to a local sink, then signs) verified by the independent
# verifier. Run inside rust:1-slim (see run_socket_e2e_in_docker.sh).
#
# Exit 0 iff every expectation holds.

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"
PASS=0; FAIL=0
ok(){  PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$1"; }
line(){ printf '%s\n' "------------------------------------------------------------"; }

echo "[build] gateway (dab-gateway, dab-agent, dab-sink) + verifier"
( cd "$DAB/gateway"  && cargo build --release --locked --quiet )
( cd "$DAB/verifier" && cargo build --release --locked --quiet )
GW="$DAB/gateway/target/release/dab-gateway"
AGENT="$DAB/gateway/target/release/dab-agent"
SINK="$DAB/gateway/target/release/dab-sink"
VERIFIER="$DAB/verifier/target/release/dab-verifier"

mkdir -p /ipc
rm -f /ipc/dab.sock /ipc/gateway.pub

"$SINK" 127.0.0.1:8080 >/dev/null 2>&1 & SINK_PID=$!
"$GW" >/dev/null 2>&1 & GW_PID=$!
cleanup(){ kill "$GW_PID" "$SINK_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Wait for the gateway to bind the socket and publish its key.
for _ in $(seq 1 100); do
  [ -S /ipc/dab.sock ] && [ -s /ipc/gateway.pub ] && break
  sleep 0.1
done
[ -S /ipc/dab.sock ] || { echo "gateway did not bind /ipc/dab.sock"; exit 1; }
PUBKEY="$(cat /ipc/gateway.pub)"
echo "gateway up; public key = $PUBKEY"
line

PAYLOAD_B64="$(printf 'hello-over-socket' | base64 | tr -d '\n')"

# ---- 1. Certified over the socket, then independently verified -------------
echo "[1] agent -> gateway (certified) -> independent verifier"
"$AGENT" --payload-b64 "$PAYLOAD_B64" --nonce sock-n1 --target http://127.0.0.1:8080 \
  > /tmp/sock_certified.json
cat /tmp/sock_certified.json
if grep -q '"status":"CERTIFIED"' /tmp/sock_certified.json && \
   "$VERIFIER" /tmp/sock_certified.json "$PUBKEY" ; then
  ok "certified-over-socket -> VERIFIED"
else
  bad "certified-over-socket should verify"
fi
line

# ---- 2. Replay of the same nonce is rejected by the WIRED ledger -----------
echo "[2] replay same nonce sock-n1 -> expect REPLAY_REJECTED (tombstone ledger)"
"$AGENT" --payload-b64 "$PAYLOAD_B64" --nonce sock-n1 --target http://127.0.0.1:8080 \
  > /tmp/sock_replay.json
cat /tmp/sock_replay.json
grep -q '"status":"REPLAY_REJECTED"' /tmp/sock_replay.json \
  && ok "replay -> REPLAY_REJECTED (wired ReplayLedger.consume returned false)" \
  || bad "replay should have been rejected by the ledger"
line

# ---- 3. Declared != executed bytes -> mutation halt ------------------------
echo "[3] --mutate (c_i != c_e), fresh nonce -> expect MUTATION_DETECTED_HALT"
"$AGENT" --payload-b64 "$PAYLOAD_B64" --nonce sock-n2 --target http://127.0.0.1:8080 --mutate \
  > /tmp/sock_mutate.json
cat /tmp/sock_mutate.json
grep -q '"status":"MUTATION_DETECTED_HALT"' /tmp/sock_mutate.json \
  && ok "mutation -> MUTATION_DETECTED_HALT" \
  || bad "mutation should halt"
line

echo "SUMMARY: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "SOCKET-E2E: OK" || { echo "SOCKET-E2E: FAILED"; exit 1; }
