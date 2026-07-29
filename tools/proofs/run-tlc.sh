#!/usr/bin/env bash
#
# Run every TLA+ specification and assert the correct DIRECTION for each.
#
# Why direction matters: a specification whose invariant passes proves nothing on its own,
# because an invariant can hold vacuously — over an empty state space, or because a
# constant was mis-typed in the .cfg so every CASE fell through. proofs/tla/README.md
# records exactly that hazard having occurred.
#
# So each specification is paired with a mutant that is deliberately broken, and this
# script asserts:
#
#   baseline spec  -> TLC must find NO violation   (exit 0)
#   mutant spec    -> TLC must find A violation    (non-zero exit)
#
# A mutant that passes is a failure of this script. That is the whole point: it means the
# property is not load-bearing, or the model is vacuous.
#
# Requires: java, and tla2tools.jar in the working directory or at $TLA_TOOLS.
#
# NON-CLAIM: a green run here establishes that the checked invariants hold over the
# bounded, declared state space of these models. It is not a proof about the running
# implementation, and it is not evidence of safety or compliance.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLA_TOOLS="${TLA_TOOLS:-${REPO_ROOT}/tla2tools.jar}"

if [[ ! -f "${TLA_TOOLS}" ]]; then
  echo "error: tla2tools.jar not found at ${TLA_TOOLS}" >&2
  echo "       download it from https://github.com/tlaplus/tlaplus/releases and set TLA_TOOLS" >&2
  exit 2
fi

# spec_dir:spec_name:expectation   where expectation is "pass" or "violate"
SPECS=(
  "proofs/tla:ProvenanceLattice:pass"
  "proofs/tla:ProvenanceLatticeMutant:violate"
  "proofs/tla:SpeculativeCollapse:pass"
  "proofs/tla:SpeculativeCollapseMutant:violate"
  "proofs/tla:TransportBoundary:pass"
  "proofs/tla:TransportBoundaryMutant:violate"
  "proofs/dab:DAB_NonceLedger:pass"
  "proofs/dab:DAB_NonceLedger_Mutant:violate"
)

failures=0
declare -a summary=()

for entry in "${SPECS[@]}"; do
  IFS=":" read -r spec_dir spec_name expectation <<<"${entry}"

  cfg="${REPO_ROOT}/${spec_dir}/${spec_name}.cfg"
  tla="${REPO_ROOT}/${spec_dir}/${spec_name}.tla"

  if [[ ! -f "${tla}" ]]; then
    echo "SKIP  ${spec_dir}/${spec_name} (no .tla)"
    summary+=("SKIP    ${spec_name} — spec file absent")
    continue
  fi
  if [[ ! -f "${cfg}" ]]; then
    # A mutant may legitimately reuse the baseline .cfg; if neither exists, skip loudly.
    echo "SKIP  ${spec_dir}/${spec_name} (no .cfg)"
    summary+=("SKIP    ${spec_name} — config absent")
    continue
  fi

  echo "==> TLC ${spec_dir}/${spec_name} (expect: ${expectation})"

  status=0
  (
    cd "${REPO_ROOT}/${spec_dir}"
    java -XX:+UseParallelGC -cp "${TLA_TOOLS}" tlc2.TLC \
      -workers auto -config "${spec_name}.cfg" "${spec_name}.tla"
  ) >"/tmp/tlc_${spec_name}.log" 2>&1 || status=$?

  if [[ "${expectation}" == "pass" ]]; then
    if [[ "${status}" -eq 0 ]]; then
      echo "    PASS (no violation, as required)"
      summary+=("OK      ${spec_name} — no violation")
    else
      echo "    FAIL: expected no violation, TLC exited ${status}" >&2
      tail -40 "/tmp/tlc_${spec_name}.log" >&2
      summary+=("FAIL    ${spec_name} — unexpected violation")
      failures=$((failures + 1))
    fi
  else
    if [[ "${status}" -ne 0 ]]; then
      echo "    PASS (violation reproduced, as required)"
      summary+=("OK      ${spec_name} — violation reproduced")
    else
      # This is the important branch. A mutant that passes means the property being
      # asserted is not load-bearing, or the model is vacuous.
      echo "    FAIL: mutant did NOT violate. The property is not load-bearing, or the" >&2
      echo "          model is vacuous (check that .cfg constants are quoted strings)." >&2
      tail -40 "/tmp/tlc_${spec_name}.log" >&2
      summary+=("FAIL    ${spec_name} — mutant passed; property not load-bearing")
      failures=$((failures + 1))
    fi
  fi
done

echo
echo "TLC summary"
echo "-----------"
for line in "${summary[@]}"; do
  echo "  ${line}"
done
echo

if [[ "${failures}" -gt 0 ]]; then
  echo "${failures} specification(s) did not behave as required." >&2
  exit 1
fi

echo "All specifications behaved as required (baselines clean, mutants violated)."
