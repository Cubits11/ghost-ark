#!/usr/bin/env bash
#
# Ghost-Ark — one-command reproduction orchestrator (USENIX Artifact Evaluation)
#
# Chain: build -> claims -> proof -> unit -> attack -> benchmark -> dissertation
#        -> artifact-report
#
# Honest and fail-closed. Each stage runs a REAL command, is timed, and records a
# status file under artifacts/status/. The final report (tools/artifact/aec-report.mjs)
# rolls them up and sets overall PASS only if every GATING stage passed. There is
# no path that manufactures a green result.
#
# Non-gating stages (their failure does not fail reproduction, but is recorded):
#   - benchmark   (measurements, not a pass/fail gate)
#   - dissertation (PDF toolchain may be absent locally; the CLAIM gate that
#                   matters is the separate, gating `claims` stage)
#
# Env:
#   GHOST_AEC_QUICK=1     smaller trial/iteration counts for a fast smoke run
#   GHOST_SKIP_DISS=1     skip the dissertation PDF stage entirely
#   VITEST_TIMEOUT_MS     per-test timeout for the unit stage (default 60000)

set -Euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATUS_DIR="$ROOT/artifacts/status"
LOG_DIR="$ROOT/artifacts/logs"
rm -rf "$STATUS_DIR"
mkdir -p "$STATUS_DIR" "$LOG_DIR"

if [ "${GHOST_AEC_QUICK:-0}" = "1" ]; then
  export GHOST_DAB_TRIALS="${GHOST_DAB_TRIALS:-1000}"
  export GHOST_BENCH_ITER="${GHOST_BENCH_ITER:-1000}"
fi
VITEST_TIMEOUT_MS="${VITEST_TIMEOUT_MS:-60000}"

log() { printf '\n\033[1m[reproduce] %s\033[0m\n' "$*" >&2; }

# sanitize a free-text detail line into something JSON-safe (no quotes/backslashes)
sanitize() { printf '%s' "$1" | tr -d '"\\' | tr '\t' ' ' | cut -c1-200; }

# run_stage <name> <label> <gating:true|false> <order> <detail_grep_regex|-> -- cmd...
run_stage() {
  local name="$1" label="$2" gating="$3" order="$4" grep_re="$5"; shift 5
  [ "$1" = "--" ] && shift
  local logf="$LOG_DIR/${name}.log"
  log "stage: $label"
  local start=$SECONDS
  local rc=0
  ( "$@" ) >"$logf" 2>&1 || rc=$?
  local secs=$(( SECONDS - start ))

  local detail=""
  if [ "$grep_re" != "-" ]; then
    detail="$(grep -aE "$grep_re" "$logf" | tail -1 || true)"
  fi
  [ -z "$detail" ] && detail="$(tail -1 "$logf" 2>/dev/null || true)"
  detail="$(sanitize "$detail")"

  cat >"$STATUS_DIR/${order}_${name}.json" <<JSON
{ "stage": "$name", "label": "$label", "exit": $rc, "gating": $gating, "order": $order, "seconds": $secs, "detail": "$detail" }
JSON

  if [ "$rc" -eq 0 ]; then
    printf '  -> PASS (%ss)\n' "$secs" >&2
  else
    printf '  -> FAIL exit=%s (%ss) — see %s\n' "$rc" "$secs" "${logf#"$ROOT"/}" >&2
  fi
  return 0  # never abort the chain; the report decides overall status
}

log "Ghost-Ark reproduction starting @ $(git rev-parse --short HEAD 2>/dev/null || echo nogit)"

# 1. build / typecheck (gating)
run_stage build "Build / typecheck (tsc --noEmit)" true 10 "error TS|Found [0-9]+ error|^$" -- \
  npm run lint

# 2. claims (gating) — prose within the Ghost-Ark claim boundary
run_stage claims "Claim-language gate" true 20 "forbidden claim violation|No forbidden" -- \
  npm run scan:claims

# 3. proof (gating) — TLA+ specs (proofs/dab quarantined by design)
run_stage proof "Formal proofs (TLA+)" true 30 "PROOFS:" -- \
  bash scripts/run-proofs.sh

# 4. unit (gating) — full vitest suite with a load-tolerant timeout
run_stage unit "Unit & integration tests" true 40 "Tests +[0-9]" -- \
  npx vitest run --test-timeout="$VITEST_TIMEOUT_MS"

# 5. attack (gating) — root security tests + DAB bench
run_stage attack "Adversarial suites" true 50 "ATTACK:" -- \
  bash scripts/run-attacks.sh

# 6. benchmark (NON-gating) — measurements
run_stage benchmark "Benchmarks" false 60 "benchmarks exported|overhead" -- \
  bash scripts/run-benchmarks.sh

# 7. dissertation (NON-gating) — PDF; needs pandoc+latexmk (present in container)
if [ "${GHOST_SKIP_DISS:-0}" = "1" ]; then
  log "stage: dissertation SKIPPED (GHOST_SKIP_DISS=1)"
  cat >"$STATUS_DIR/70_dissertation.json" <<JSON
{ "stage": "dissertation", "label": "Dissertation PDF", "exit": 0, "gating": false, "order": 70, "seconds": 0, "detail": "skipped" }
JSON
else
  run_stage dissertation "Dissertation PDF" false 70 "PDF written|pandoc|latexmk|claim" -- \
    bash docs/dissertation/build_paper.sh
fi

# 8. artifact-report — always runs; its exit code is the reproduction's exit code
log "stage: artifact-report"
node tools/artifact/aec-report.mjs
REPORT_RC=$?

exit "$REPORT_RC"
