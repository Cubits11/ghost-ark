#!/usr/bin/env bash
# Ghost-Ark local bootstrap: zero-AWS-credentials setup + the local claim gates.
#
# What this does: dependency install, then the four local gates (lint, forbidden-
# claims scan, required-docs check, assumption lattice). It does NOT deploy
# anything, does NOT need AWS credentials, and passing it means only that the
# local gates pass on this checkout.
#
# Usage:
#   ./scripts/bootstrap-local.sh            # fast: installs only if node_modules is absent
#   ./scripts/bootstrap-local.sh --fresh    # force a clean npm ci
#
# Exit-code discipline: every gate runs bare (no pipes), so a failing gate fails
# this script. Do not "fix" this by piping through head/tail — that masks exits.
set -euo pipefail
cd "$(dirname "$0")/.."

banner() { printf '\n=== %s ===\n' "$1"; }

banner "node / npm versions"
node --version
npm --version

if [[ "${1:-}" == "--fresh" || ! -d node_modules ]]; then
  banner "npm ci (clean install)"
  npm ci
else
  banner "dependencies present (use --fresh to force npm ci)"
fi

banner "gate 1/4: lint (tsc --noEmit)"
npm run lint

banner "gate 2/4: forbidden-claims scan"
npm run claims:check

banner "gate 3/4: required-docs check"
npm run docs:check

banner "gate 4/4: assumption lattice"
npm run assumptions

banner "bootstrap complete"
echo "All four local gates passed on this checkout."
echo "Next: ./scripts/run-local-demo.sh   (receipt verification + governed invoke, still zero-AWS)"
echo "Full local suite: npm test    Full local checklist: npm run checklist:local"
