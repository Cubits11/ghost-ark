#!/usr/bin/env bash
#
# Ghost-Ark — TLA+ proof runner (Artifact Evaluation)
#
# Runs every TLA+ specification through TLC and records real output under
# proofs/**/artifacts/. Honest and fail-closed:
#   - baseline specs must report NO violation
#   - mutant specs MUST report a violation (a clean mutant means the invariant
#     is vacuous, which is itself a failure)
#   - the DAB NonceLedger specs are QUARANTINED: they are invalid TLA+ at HEAD
#     (LaTeX \setminus for TLA+ set-difference \), and once corrected the baseline
#     violates its own NoReplays invariant. This runner does NOT edit them to
#     force a pass. See docs/artifact/repository_inventory.md sections 7.1-7.2.
#
# Emits a machine-readable summary to artifacts/proofs/proofs_summary.json.
#
# Usage: scripts/run-proofs.sh
# Env:   TLA_TOOLS_JAR  override path to tla2tools.jar (else fetched to .cache/tla)

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARTIFACT_DIR="$ROOT/artifacts/proofs"
mkdir -p "$ARTIFACT_DIR"
SUMMARY="$ARTIFACT_DIR/proofs_summary.json"

# Pinned tla2tools release. sha256 recorded so a substituted jar is detected.
TLA_TOOLS_VERSION="v1.8.0"
TLA_TOOLS_SHA256="58d44845a37a8d776deaf8cf3a623213b59d311bc0ec287bcdfbe148dd11bb3d"
TLA_TOOLS_URL="https://github.com/tlaplus/tlaplus/releases/download/${TLA_TOOLS_VERSION}/tla2tools.jar"
JAR="${TLA_TOOLS_JAR:-$ROOT/.cache/tla/tla2tools.jar}"

# Per-spec wall-clock cap (seconds). The proofs/tla family finishes in <10s each;
# this only guards against a stub/model that fails to terminate.
TLC_TIMEOUT="${TLC_TIMEOUT:-120}"

log() { printf '[proofs] %s\n' "$*" >&2; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

ensure_jar() {
  if [ -f "$JAR" ]; then
    local got; got="$(sha256_of "$JAR")"
    if [ "$got" = "$TLA_TOOLS_SHA256" ]; then log "tla2tools present ($TLA_TOOLS_VERSION)"; return 0; fi
    log "WARNING: tla2tools sha256 mismatch (got $got); re-fetching"
  fi
  if ! command -v java >/dev/null 2>&1; then
    log "ERROR: java not found and no valid tla2tools.jar. Install a JDK (>=11)."
    return 1
  fi
  mkdir -p "$(dirname "$JAR")"
  log "fetching tla2tools $TLA_TOOLS_VERSION"
  curl -fsSL -o "$JAR" "$TLA_TOOLS_URL"
  local got; got="$(sha256_of "$JAR")"
  if [ "$got" != "$TLA_TOOLS_SHA256" ]; then
    log "ERROR: downloaded tla2tools sha256 $got != pinned $TLA_TOOLS_SHA256"; return 1
  fi
}

# run_spec <dir> <module> <cfg> <expect: clean|violation> <label>
# Prints one JSON object to stdout; returns 0 iff expectation met.
run_spec() {
  local dir="$1" module="$2" cfg="$3" expect="$4" label="$5"
  # Write this run's fresh TLC output into the gitignored artifacts/ tree. The
  # committed reference copies under proofs/**/artifacts/ are left untouched, so
  # `make proof` never dirties tracked evidence.
  local out_dir="$ROOT/artifacts/proofs/logs"
  mkdir -p "$out_dir"
  local log_file="$out_dir/${module}.tlc.txt"
  local meta; meta="$(mktemp -d)"
  local rc=0 pid waited=0
  # Portable per-spec timeout: `exec java` makes the background PID the JVM
  # itself, so a kill terminates TLC directly (no orphaned checker).
  ( cd "$dir" && exec java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC \
      -workers auto -metadir "$meta" -config "$cfg" "$module.tla" ) >"$log_file" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$TLC_TIMEOUT" ]; then
      kill -KILL "$pid" 2>/dev/null; rc=124
      printf '\n[run-proofs] TIMEOUT after %ss\n' "$TLC_TIMEOUT" >>"$log_file"
      break
    fi
    sleep 1; waited=$(( waited + 1 ))
  done
  if [ "$rc" -ne 124 ]; then wait "$pid"; rc=$?; else wait "$pid" 2>/dev/null || true; fi
  rm -rf "$meta"
  # Clean up TLC-generated trace-exploration files so the tree stays pristine.
  rm -f "$dir/${module}_TTrace_"*.tla "$dir/${module}_TTrace_"*.bin 2>/dev/null || true

  local parsed="true" clean="false" violation="false" states=""
  if grep -qE "Parse Error|Could not parse module|Errors: [1-9]" "$log_file"; then parsed="false"; fi
  if grep -qE "No error has been found" "$log_file"; then clean="true"; fi
  if grep -qE "is violated|Temporal properties were violated|Error: The behavior up to this point" "$log_file"; then violation="true"; fi
  states="$(grep -oE "[0-9,]+ distinct states found" "$log_file" | tail -1 | grep -oE "[0-9,]+" | head -1 | tr -d ',' || true)"

  local met="false" status=""
  if [ "$parsed" = "false" ]; then
    status="PARSE_ERROR"; met="false"
  elif [ "$expect" = "clean" ]; then
    if [ "$clean" = "true" ] && [ "$violation" = "false" ]; then status="CLEAN"; met="true"; else status="UNEXPECTED_VIOLATION"; met="false"; fi
  else # expect violation
    if [ "$violation" = "true" ]; then status="VIOLATION_REPRODUCED"; met="true"; else status="NO_VIOLATION"; met="false"; fi
  fi

  printf '{"module":"%s","expect":"%s","status":"%s","met":%s,"parsed":%s,"distinct_states":%s,"log":"%s","label":"%s"}' \
    "$module" "$expect" "$status" "$met" "$parsed" "${states:-null}" \
    "$(printf '%s' "$log_file" | sed "s#$ROOT/##")" "$label"

  [ "$met" = "true" ]
}

ensure_jar || { echo '{"error":"tla2tools unavailable"}' >"$SUMMARY"; exit 1; }

log "running proofs/tla family (expected to pass)"
declare -a RESULTS
OVERALL=0

# proofs/tla — real, recorded, load-bearing specs
for entry in \
  "ProvenanceLattice:clean" \
  "ProvenanceLatticeMutant:violation" \
  "SpeculativeCollapse:clean" \
  "SpeculativeCollapseMutant:violation" \
  "TransportBoundary:clean" \
  "TransportBoundaryMutant:violation" \
; do
  module="${entry%%:*}"; expect="${entry##*:}"
  log "  $module (expect $expect)"
  if json="$(run_spec "$ROOT/proofs/tla" "$module" "$module.cfg" "$expect" "tla")"; then :; else OVERALL=1; fi
  RESULTS+=("$json")
done

# TenantIsolation is a DECLARED STUB (proofs/tla/README.md: "stub, not checked").
# It is recorded statically and NOT executed: as written it does not terminate
# under TLC, and the project treats it as a placeholder, not a claim. Running it
# would be dishonest either way (a hang is not a result).
log "  TenantIsolation (declared stub — recorded, not executed)"
RESULTS+=('{"module":"TenantIsolation","expect":"n/a","status":"DECLARED_STUB","met":true,"parsed":null,"distinct_states":null,"log":"proofs/tla/TenantIsolation.tla","label":"tla-stub","gating":false}')

# proofs/dab — QUARANTINED. Recorded as expected-broken so the artifact tells the
# truth. These are NOT gating in the "pass" sense; they gate GREEN by staying red.
log "running proofs/dab family (QUARANTINED — invalid TLA+ at HEAD; see inventory 7.1-7.2)"
for entry in "DAB_NonceLedger" "DAB_NonceLedger_Mutant"; do
  log "  $entry (quarantined)"
  json="$(run_spec "$ROOT/proofs/dab" "$entry" "DAB_NonceLedger.cfg" "clean" "dab-quarantined" || true)"
  # Mark quarantined so it does not silently read as a normal failure.
  json="${json/\"label\":\"dab-quarantined\"/\"label\":\"dab-quarantined\",\"quarantined\":true}"
  RESULTS+=("$json")
  OVERALL=1
done

# Assemble summary JSON
{
  printf '{\n  "tool":"tla2tools %s",\n  "generated_note":"real TLC output; artifacts under proofs/**/artifacts/",\n  "results":[\n' "$TLA_TOOLS_VERSION"
  for i in "${!RESULTS[@]}"; do
    printf '    %s' "${RESULTS[$i]}"
    if [ "$i" -lt $(( ${#RESULTS[@]} - 1 )) ]; then printf ',\n'; else printf '\n'; fi
  done
  printf '  ],\n  "all_gating_passed": %s\n}\n' "$([ "$OVERALL" -eq 0 ] && echo true || echo false)"
} >"$SUMMARY"

log "summary written to ${SUMMARY#"$ROOT"/}"
if [ "$OVERALL" -eq 0 ]; then
  log "PROOFS: all gating specs met expectation (proofs/dab remains quarantined by design)"
else
  log "PROOFS: NOT all clear — proofs/dab is quarantined (expected) and/or a tla spec regressed"
fi
exit "$OVERALL"
