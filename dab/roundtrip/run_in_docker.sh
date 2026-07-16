#!/usr/bin/env bash
#
# Reviewer convenience: run the DAB gateway<->verifier round-trip inside a
# pinned Rust container, no host toolchain required. Requires only Docker.
#
#   bash dab/roundtrip/run_in_docker.sh
#
# Reproduces dab/roundtrip/RECORDED_ROUNDTRIP.txt. Because the gateway uses a
# fixed DEV ed25519 seed, the public key and signature are deterministic.

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"

docker run --rm \
  -v "$DAB":/dab \
  -w /dab \
  rust:1-slim \
  bash roundtrip/run_roundtrip.sh
