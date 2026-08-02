#!/usr/bin/env bash
#
# E10 sweep: run Stryker over each declared kernel file, one at a time.
#
# WHY ONE FILE AT A TIME
#
# Two attempts at the full 10-file scope in a single invocation were killed
# before completing, losing everything. Stryker also copies the working tree per
# worker, so a single large run holds ~11 GB and starves anything else on the
# machine. Running per file makes each result durable the moment it lands, and a
# failure costs one file rather than the sweep.
#
# This changes nothing about the measurement. The score is per file either way;
# `stryker.config.json` still declares the full pinned scope, and `--mutate`
# only narrows which of those files this invocation evaluates. The summarizer
# reports measured-vs-declared so a partial sweep cannot be read as a complete
# one.
#
# Usage:  bash tools/experiments/run-e10-sweep.sh [file ...]
#         With no arguments, sweeps every declared kernel file.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

OUT="artifacts/mutation"
mkdir -p "$OUT"
SWEEP_LOG="$OUT/sweep.log"

DEFAULT_FILES=(
  packages/enforcement-runtime/src/receipts/canonical.ts
  packages/enforcement-runtime/src/receipts/chain.ts
  packages/enforcement-runtime/src/receipts/emission.ts
  packages/enforcement-runtime/src/receipts/keyManifest.ts
  packages/enforcement-runtime/src/receipts/kmsSigner.ts
  packages/enforcement-runtime/src/receipts/kmsVerifier.ts
  packages/enforcement-runtime/src/receipts/signer.ts
  packages/enforcement-runtime/src/receipts/verifier.ts
)

if [ "$#" -gt 0 ]; then FILES=("$@"); else FILES=("${DEFAULT_FILES[@]}"); fi

{
  echo "=== E10 sweep started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "host: $(uname -sm) | node $(node -v) | files: ${#FILES[@]}"
} >> "$SWEEP_LOG"

for file in "${FILES[@]}"; do
  name="$(basename "$file" .ts)"
  echo "--- $name start $(date -u +%H:%M:%SZ) ---" >> "$SWEEP_LOG"

  # A stale incremental file makes Stryker reuse verdicts from a different
  # --mutate target, which would silently report another file's results.
  rm -f "$OUT/stryker-incremental.json"

  npx stryker run --mutate "$file" --reporters clear-text,json > "$OUT/$name.log" 2>&1
  status=$?

  if [ -f "$OUT/report.json" ]; then cp "$OUT/report.json" "$OUT/report-$name.json"; fi

  score="$(grep -oE '^ [A-Za-z]+\.ts *\|[^|]*\|' "$OUT/$name.log" | head -1 | tr -s ' ')"
  {
    echo "--- $name done exit=$status $(date -u +%H:%M:%SZ) ---"
    grep -E '^All files' "$OUT/$name.log" | tr -s ' ' || echo "  (no score line — see $name.log)"
  } >> "$SWEEP_LOG"
done

echo "=== E10 sweep finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$SWEEP_LOG"
