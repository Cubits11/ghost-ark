#!/usr/bin/env bash

set -Eeuo pipefail


###############################################################################
#
# Ghost-Ark DAB Tier-0
#
# Cryptographic Execution Consistency Reproduction Artifact
#
# Publication-grade evaluation harness
#
# Experiments:
#
# 1  Trusted Network Boundary
# 2  Declaration Commitment Pipeline
# 3  Independent Verification
# 4  Pre-Execution Enforcement
# 5  Mutation / Replay / Confusion Attacks
# 6  Formal Security Games
# 7  Serialization Collision Defense
# 8  Concurrency Attack Resistance
# 9  Performance Evaluation
# 10 Artifact Reproducibility
#
###############################################################################



ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESULT_DIR="$ROOT/artifacts/results"

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"

RESULT_FILE="$RESULT_DIR/dab-results-$TIMESTAMP.json"

LOG_FILE="$RESULT_DIR/dab-run-$TIMESTAMP.log"



mkdir -p "$RESULT_DIR"



exec > >(tee -a "$LOG_FILE") 2>&1





###############################################################################
# FAILURE HANDLER
###############################################################################

failure(){

    echo ""
    echo "================================================="
    echo " DAB ARTIFACT FAILURE "
    echo "================================================="

    echo "Logs preserved:"
    echo "$LOG_FILE"

    docker compose logs || true

    exit 1
}


trap failure ERR






###############################################################################
# HEADER
###############################################################################

echo "================================================="
echo " Ghost-Ark DAB Tier-0 Artifact Runner "
echo "================================================="

echo ""
echo "Timestamp:"
date -u

echo ""






###############################################################################
# ENVIRONMENT VALIDATION
###############################################################################


echo "[0/10] Validating environment"



command -v docker >/dev/null
command -v cargo >/dev/null
command -v node >/dev/null
command -v jq >/dev/null



echo "Docker:"
docker --version


echo "Rust:"
rustc --version


echo "Node:"
node --version


echo "jq:"
jq --version





###############################################################################
# SOURCE INTEGRITY
###############################################################################


echo ""
echo "[1/10] Capturing source integrity"



if git rev-parse --git-dir >/dev/null 2>&1
then

    git rev-parse HEAD \
        > "$RESULT_DIR/git-commit.txt"

fi




find "$ROOT" \
    -type f \
    \( -name "*.rs" -o -name "*.ts" -o -name "*.json" \) \
    -exec sha256sum {} \; \
    > "$RESULT_DIR/source-hashes.txt"







###############################################################################
# BUILD TRUSTED COMPONENTS
###############################################################################


echo ""
echo "[2/10] Building Rust Trusted Computing Base"



(
cd "$ROOT/gateway"

cargo build --release

)



(
cd "$ROOT/verifier"

cargo build --release

)





###############################################################################
# CLEAN OLD STATE
###############################################################################


echo ""
echo "[3/10] Resetting execution environment"



docker compose down \
    --remove-orphans \
    || true




###############################################################################
# START ISOLATED SYSTEM
###############################################################################


echo ""
echo "[4/10] Starting DAB isolated containers"



docker compose up \
    --build \
    -d





sleep 3





###############################################################################
# NETWORK BOUNDARY TEST
###############################################################################


echo ""
echo "[5/10] Testing Trusted Boundary"



echo "Checking network namespace"



NETWORK_RESULT=$(

docker exec agent-runtime \
    ip route 2>/dev/null \
    || true

)



if echo "$NETWORK_RESULT" | grep -q default
then

    echo "FAIL: agent-runtime possesses route"

    exit 1

fi



echo "PASS: no default route"





echo "Testing DNS"



if docker exec agent-runtime \
    nslookup google.com >/dev/null 2>&1
then

    echo "FAIL: DNS escape detected"

    exit 1

else

    echo "PASS: DNS blocked"

fi






###############################################################################
# RUN SECURITY GAMES
###############################################################################


echo ""
echo "[6/10] Executing adversarial benchmark suite"



docker exec agent-runtime \
    node /app/bench/run_all.js \
    > "$RESULT_FILE"







###############################################################################
# VALIDATE RESULTS
###############################################################################


echo ""
echo "[7/10] Validating empirical claims"



jq empty "$RESULT_FILE"



ADV=$(

jq '.global_advantage' "$RESULT_FILE"

)



echo ""
echo "Measured attacker advantage:"
echo "$ADV"



if [[ "$ADV" != "0" && "$ADV" != "0.0" ]]
then

    echo "FAIL: attacker advantage detected"

    exit 1

fi





###############################################################################
# RECEIPT VERIFICATION
###############################################################################


echo ""
echo "[8/10] Running independent receipt verifier"



"$ROOT/verifier/target/release/verifier" \
    "$RESULT_FILE"







###############################################################################
# PERFORMANCE REPORT
###############################################################################


echo ""
echo "[9/10] Generating performance summary"



jq '
{
 protocol,
 trials,
 global_advantage,
 all_passed,
 games:
 [
   .games[]
   |
   {
    game,
    advantage,
    p50_latency_ms,
    p95_latency_ms
   }
 ]
}
' "$RESULT_FILE"







###############################################################################
# FINAL ARTIFACT SEAL
###############################################################################


echo ""
echo "[10/10] Sealing artifact"



sha256sum \
    "$RESULT_FILE" \
    > "$RESULT_FILE.sha256"




echo ""
echo "================================================="
echo " DAB Tier-0 Artifact Complete "
echo "================================================="

echo ""
echo "Results:"
echo "$RESULT_FILE"


echo ""
echo "Hash:"
cat "$RESULT_FILE.sha256"


echo ""

echo "Execution status: VERIFIED"