#!/usr/bin/env bash
#
# Ghost-Ark — benchmark runner (Artifact Evaluation)
#
# Runs the DAB Tier-0 performance + formal-game benchmarks and exports raw JSON
# to artifacts/benchmarks/. These are measurements, not pass/fail gates: the
# numbers (latency p50/p95/p99, throughput, overhead %) are recorded as produced.
# The formal-game attacker-advantage figures are real but reflect the benchmark's
# current (partly inverted) accounting — see repository_inventory.md 7.6.
#
# This stage is non-gating for `make reproduce` correctness: it always records
# what it measured and exits 0 as long as the benchmark process ran.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/benchmarks"
mkdir -p "$OUT"
ITER="${GHOST_BENCH_ITER:-10000}"

log() { printf '[bench] %s\n' "$*" >&2; }

log "performance benchmark (performance.ts, iterations=$ITER)"
node --experimental-strip-types dab/bench/performance.ts >"$OUT/performance.json" 2>"$OUT/performance.err" || {
  log "ERROR: performance benchmark process failed; see artifacts/benchmarks/performance.err"; exit 1;
}

log "formal games (formal_games.ts)"
node --experimental-strip-types dab/bench/formal_games.ts >"$OUT/formal_games.json" 2>"$OUT/formal_games.err" || {
  log "ERROR: formal-games process failed; see artifacts/benchmarks/formal_games.err"; exit 1;
}

# Human-readable digest (dependency-free).
node -e '
  const fs = require("fs");
  const perf = JSON.parse(fs.readFileSync("artifacts/benchmarks/performance.json","utf8"));
  const fg = JSON.parse(fs.readFileSync("artifacts/benchmarks/formal_games.json","utf8"));
  const digest = {
    protocol: perf.protocol,
    latency_ms: {
      commitment_p95: perf.commitment?.p95_ms,
      verification_p95: perf.verification?.p95_ms,
      end_to_end_p95: perf.end_to_end?.p95_ms,
    },
    throughput_ops_sec: {
      commitment: perf.commitment?.throughput_ops_sec,
      verification: perf.verification?.throughput_ops_sec,
    },
    overhead_percent: perf.overhead_percent,
    formal_global_advantage: fg.global_advantage,
    formal_all_passed: fg.all_passed,
    accounting_caveat: "formal-game advantages reflect current benchmark accounting; see repository_inventory.md 7.6",
  };
  fs.writeFileSync("artifacts/benchmarks/benchmarks_summary.json", JSON.stringify(digest, null, 2) + "\n");
  process.stderr.write("[bench] overhead=" + (perf.overhead_percent||0).toFixed(1) + "% global_advantage=" + fg.global_advantage + "\n");
'

log "benchmarks exported to artifacts/benchmarks/"
exit 0
