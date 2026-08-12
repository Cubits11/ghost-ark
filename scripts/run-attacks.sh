#!/usr/bin/env bash
#
# Ghost-Ark — adversarial suite runner (Artifact Evaluation)
#
# ONE body of adversarial evidence, and one quarantined smoke run that is NOT
# evidence and does NOT gate.
#
#   1. GATING — Root security tests (tests/security/**): policy fuzzer, receipt
#      negative corpus, tenant boundary, governed-invoke tenant boundary.
#      Correctly written, part of npm test, exercises real components.
#
#   2. NON-GATING, NON-EVIDENTIAL — DAB Tier-0 bench (dab/bench/run_all.ts).
#
# WHY 2 STOPPED GATING (2026-08-11)
#
# This header used to call both "real, independent bodies of adversarial
# evidence", and the script exited non-zero if the bench failed. That is the
# exact opposite of what dab/bench/README.md says about itself: "QUARANTINED: not
# evidence about Ghost-Ark ... Do not cite any output of this directory as
# evidence for any claim." Its suites reported detected:true while invoking no
# component of the system under test; the retractions are R1-R5 and R10.
#
# The quarantine was enforced one indirection too high. benchQuarantine.test.ts
# asserted that no *workflow file* mentions dab/bench -- true, because
# artifact.yml says `make reproduce`, which calls this script, which ran the
# bench and printed "ATTACK: all adversarial evidence green" over its result. The
# manuscript then claimed the quarantine was backed by "a test asserting no
# workflow treats it as such", which was true of the file text and false in
# effect.
#
# The bench still RUNS, because deleting the record would hide that it ever did.
# It is reported under `quarantined_smoke`, it cannot fail this script, and its
# numbers -- including global_advantage -- are deliberately not surfaced as
# headline output. Executing something is not citing it.
#
# Emits artifacts/attacks/attacks_summary.json. Exits non-zero only if the
# gating body of evidence fails.

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

# Quarantined smoke run. Executed so the record shows it still runs; its exit
# status is captured but deliberately NOT used in the gate below, and its
# numbers are not extracted into the summary.
log "quarantined smoke: dab/bench/run_all.ts (NOT evidence, NOT gating, trials=$TRIALS)"
if node --experimental-strip-types dab/bench/run_all.ts --trials "$TRIALS" >"$OUT/dab_bench.json" 2>"$OUT/dab_bench.err"; then
  dab_rc=0
else
  dab_rc=$?
fi

cat >"$OUT/attacks_summary.json" <<JSON
{
  "gating_evidence": {
    "root_security": {
      "passed": $([ "$sec_rc" -eq 0 ] && echo true || echo false),
      "log": "artifacts/attacks/root_security.log"
    }
  },
  "quarantined_smoke": {
    "dab_bench": {
      "exit_status": $dab_rc,
      "gating": false,
      "is_evidence": false,
      "why": "dab/bench/README.md: 'QUARANTINED: not evidence about Ghost-Ark. Do not cite any output of this directory as evidence for any claim.' Retractions R1-R5 and R10. Executed for the record only; no figure from this run may be quoted.",
      "artifact": "artifacts/attacks/dab_bench.json"
    }
  }
}
JSON

log "gating: root_security passed=$([ "$sec_rc" -eq 0 ] && echo true || echo false)"
log "non-gating: dab/bench smoke exit=$dab_rc (quarantined; not evidence)"

if [ "$sec_rc" -eq 0 ]; then
  log "ATTACK: gating adversarial evidence green"
  exit 0
fi
log "ATTACK: not green (root_security=$sec_rc). See artifacts/attacks/."
exit 1
