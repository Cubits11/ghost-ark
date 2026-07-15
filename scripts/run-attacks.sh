#!/usr/bin/env bash
#
# Ghost-Ark — adversarial suite runner (Artifact Evaluation)
#
# Two real, independent bodies of adversarial evidence:
#   1. Root security tests (tests/security/**): policy fuzzer, receipt negative
#      corpus, tenant boundary, governed-invoke tenant boundary. Correctly
#      written, part of npm test. Expected: PASS.
#   2. DAB Tier-0 bench (dab/bench/run_all.ts): mutation/replay/unicode/
#      concurrency + 4 formal games. Runs real code. Currently RED because two
#      suites score backwards (see docs/artifact/repository_inventory.md 7.6).
#      Recorded honestly; not patched to force green.
#
# Emits artifacts/attacks/dab_bench.json and artifacts/attacks/attacks_summary.json.
# Exits non-zero if either body of evidence fails.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/attacks"
mkdir -p "$OUT"
TRIALS="${GHOST_DAB_TRIALS:-10000}"

log() { printf '[attack] %s\n' "$*" >&2; }

sec_rc=0
dab_rc=0

log "1/2 root security tests (tests/security/**)"
if npx vitest run tests/security 2>&1 | tee "$OUT/root_security.log" | tail -3; then
  sec_rc=0
else
  sec_rc=1
fi

log "2/2 DAB Tier-0 bench (dab/bench/run_all.ts, trials=$TRIALS)"
if node --experimental-strip-types dab/bench/run_all.ts --trials "$TRIALS" >"$OUT/dab_bench.json" 2>"$OUT/dab_bench.err"; then
  dab_rc=0
else
  dab_rc=$?
fi

# Extract honest headline numbers from the DAB bench JSON (dependency-free).
DAB_ADV="$(node -e 'try{const d=require("./artifacts/attacks/dab_bench.json");process.stdout.write(String(d.global_advantage))}catch(e){process.stdout.write("null")}' 2>/dev/null || echo null)"
DAB_PASS="$(node -e 'try{const d=require("./artifacts/attacks/dab_bench.json");process.stdout.write(String(d.all_passed))}catch(e){process.stdout.write("false")}' 2>/dev/null || echo false)"

cat >"$OUT/attacks_summary.json" <<JSON
{
  "root_security": { "passed": $([ "$sec_rc" -eq 0 ] && echo true || echo false), "log": "artifacts/attacks/root_security.log" },
  "dab_bench": {
    "passed": $([ "$dab_rc" -eq 0 ] && echo true || echo false),
    "global_advantage": ${DAB_ADV:-null},
    "all_passed": ${DAB_PASS:-false},
    "note": "RED reason is inverted benchmark accounting, not a defense failure — see repository_inventory.md 7.6",
    "artifact": "artifacts/attacks/dab_bench.json"
  }
}
JSON

log "root_security passed=$([ "$sec_rc" -eq 0 ] && echo true || echo false); dab_bench passed=$([ "$dab_rc" -eq 0 ] && echo true || echo false) (global_advantage=$DAB_ADV)"

if [ "$sec_rc" -eq 0 ] && [ "$dab_rc" -eq 0 ]; then
  log "ATTACK: all adversarial evidence green"
  exit 0
fi
log "ATTACK: not green (root_security=$sec_rc dab_bench=$dab_rc). See artifacts/attacks/ and inventory 7.6."
exit 1
