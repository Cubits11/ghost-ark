#!/usr/bin/env bash
#
# Ghost-Ark — dissertation build pipeline (USENIX Artifact Evaluation)
#
# Pipeline:
#   1. Discover chapter files 00_*.md .. 10_*.md (deterministic, sorted).
#   2. CLAIM GATE (fail-closed): run the forbidden-claims scanner over the
#      chapters. If the prose exceeds the Ghost-Ark claim boundary, STOP. The
#      build refuses to emit a PDF that overclaims. It does NOT edit the prose.
#   3. Concatenate deterministically with a generated front matter block.
#   4. pandoc  -> docs/dissertation/ghost-ark-usenix.tex
#   5. latexmk -> docs/dissertation/ghost-ark-usenix.pdf
#
# Requirements: pandoc, latexmk, a TeX Live install (all present in
# Dockerfile.reviewer). If they are absent, the script explains and exits 3
# WITHOUT claiming success.
#
# Env:
#   GHOST_DISS_ALLOW_OVERCLAIM=1  proceed past a RED claim gate (records a loud
#                                 warning in the output; for author drafts only).

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"

TITLE="Verifiable Agent Governance under Correlated Guardrail Failure"
SUBTITLE="Ghost-Ark, Declarative Action Binding, and the CC-Framework"
OUT_TEX="$HERE/ghost-ark-usenix.tex"
OUT_PDF="$HERE/ghost-ark-usenix.pdf"
COMBINED="$HERE/.build/combined.md"

log() { printf '[dissertation] %s\n' "$*" >&2; }

# 1. discover chapters ---------------------------------------------------------
mapfile -t CHAPTERS < <(ls "$HERE"/[0-9][0-9]_*.md 2>/dev/null | sort)
if [ "${#CHAPTERS[@]}" -eq 0 ]; then
  log "ERROR: no chapter files (NN_*.md) found in $HERE"; exit 2
fi
log "discovered ${#CHAPTERS[@]} chapters: $(basename -a "${CHAPTERS[@]}" | tr '\n' ' ')"

# 2. claim gate (fail-closed) --------------------------------------------------
log "running claim-language gate over dissertation chapters"
CLAIM_LOG="$HERE/.build/claims.log"
mkdir -p "$HERE/.build"
CLAIM_RC=0
( cd "$ROOT" && node tools/research/check-forbidden-claims.mjs docs/dissertation ) >"$CLAIM_LOG" 2>&1 || CLAIM_RC=$?
if [ "$CLAIM_RC" -ne 0 ]; then
  log "CLAIM GATE: RED — the chapters contain forbidden assurance language:"
  sed 's/^/    /' "$CLAIM_LOG" >&2 || true
  if [ "${GHOST_DISS_ALLOW_OVERCLAIM:-0}" != "1" ]; then
    log "Refusing to build a PDF that overclaims. Bring the prose within the Ghost-Ark"
    log "claim boundary (see docs/compliance/non-claims.md), or set"
    log "GHOST_DISS_ALLOW_OVERCLAIM=1 to build a clearly-marked author draft."
    exit 4
  fi
  log "GHOST_DISS_ALLOW_OVERCLAIM=1 set — proceeding with a NON-CLEAN draft."
  OVERCLAIM_BANNER="\\\\textbf{DRAFT — claim gate RED: this document contains assurance language outside the Ghost-Ark claim boundary and is not review-ready.}"
else
  log "CLAIM GATE: green"
  OVERCLAIM_BANNER=""
fi

# 3. concatenate ---------------------------------------------------------------
COMMIT="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
{
  cat <<MD
---
title: "$TITLE"
subtitle: "$SUBTITLE"
author: "Ghost-Ark Research"
date: "Commit $COMMIT"
documentclass: article
classoption: [11pt]
geometry: margin=1in
colorlinks: true
toc: true
numbersections: true
---

MD
  if [ -n "${OVERCLAIM_BANNER:-}" ]; then
    printf '%s\n\n' "$OVERCLAIM_BANNER"
  fi
  for ch in "${CHAPTERS[@]}"; do
    cat "$ch"
    printf '\n\n\\newpage\n\n'
  done
} >"$COMBINED"
log "combined markdown -> ${COMBINED#"$ROOT"/}"

# 4/5. require pandoc + latexmk ------------------------------------------------
if ! command -v pandoc >/dev/null 2>&1; then
  log "pandoc not found. Install it (present in Dockerfile.reviewer) or run:"
  log "    docker compose -f docker-compose.reviewer.yml run --rm reviewer make dissertation"
  exit 3
fi

log "pandoc -> LaTeX"
pandoc "$COMBINED" \
  --from=markdown+tex_math_dollars+raw_tex \
  --to=latex --standalone \
  --highlight-style=tango \
  -V linkcolor:blue \
  -o "$OUT_TEX"
log "wrote ${OUT_TEX#"$ROOT"/}"

if ! command -v latexmk >/dev/null 2>&1; then
  log "latexmk not found; wrote .tex only. Install TeX Live (present in Dockerfile.reviewer)."
  exit 3
fi

log "latexmk -> PDF"
latexmk -pdf -interaction=nonstopmode -halt-on-error \
  -outdir="$HERE" "$OUT_TEX" >"$HERE/.build/latexmk.log" 2>&1 || {
    log "ERROR: latexmk failed; tail of log:"; tail -20 "$HERE/.build/latexmk.log" >&2; exit 5;
  }
latexmk -c -outdir="$HERE" "$OUT_TEX" >/dev/null 2>&1 || true

if [ -f "$OUT_PDF" ]; then
  log "PDF written -> ${OUT_PDF#"$ROOT"/}"
  exit 0
fi
log "ERROR: latexmk reported success but no PDF at $OUT_PDF"
exit 5
