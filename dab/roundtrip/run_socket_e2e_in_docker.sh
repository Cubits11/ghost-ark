#!/usr/bin/env bash
#
# Reviewer convenience: run the full Unix-socket E2E (real gateway process,
# agent client, sink, wired tombstone ledger, independent verifier) inside a
# pinned Rust container. Requires only Docker.
#
#   bash dab/roundtrip/run_socket_e2e_in_docker.sh
#
# Reproduces dab/roundtrip/RECORDED_SOCKET_E2E.txt (timestamps vary; the
# statuses and verification results are stable).

set -Euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"

docker run --rm -v "$DAB":/dab -w /dab rust:1-slim bash roundtrip/run_socket_e2e.sh
