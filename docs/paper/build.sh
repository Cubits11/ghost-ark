#!/usr/bin/env bash
#
# Ghost-Ark — conference manuscript build (docs/paper/main.tex -> main.pdf)
#
# Pipeline (mirrors docs/dissertation/build_paper.sh discipline):
#   1. CLAIM GATE (fail-closed): the forbidden-claims scanner runs repo-wide
#      and covers .tex/.bib. If the manuscript exceeds the Ghost-Ark claim
#      boundary, STOP. The build refuses to emit a PDF that overclaims.
#   2. latexmk -pdf main.tex — locally if TeX Live is installed, otherwise
#      inside the reviewer container (ghost-ark-reviewer:latest), which ships
#      TeX Live. If neither is available, exit 3 WITHOUT claiming success.
#
# Usage:  bash docs/paper/build.sh

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

echo "[paper] 1/2 claim-language gate (fail-closed)"
if ! (cd "$ROOT" && node tools/research/check-forbidden-claims.mjs); then
  echo "[paper] REFUSING to build: the claim gate is red. Fix the prose," >&2
  echo "[paper] do not weaken the scanner." >&2
  exit 2
fi

echo "[paper] 2/2 latexmk"
if command -v latexmk >/dev/null 2>&1; then
  (cd "$HERE" && latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex)
elif command -v docker >/dev/null 2>&1 && docker image inspect ghost-ark-reviewer:latest >/dev/null 2>&1; then
  docker run --rm -v "$ROOT:/work" -w /work/docs/paper ghost-ark-reviewer:latest \
    latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
else
  echo "[paper] No latexmk on host and no ghost-ark-reviewer:latest image." >&2
  echo "[paper] Build it first:  docker compose -f docker-compose.reviewer.yml build" >&2
  echo "[paper] NOT claiming success; no PDF was produced." >&2
  exit 3
fi

echo "[paper] OK: docs/paper/main.pdf"
