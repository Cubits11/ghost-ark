#!/usr/bin/env bash
#
# Ghost-Ark DAB Tier-0 — gateway <-> independent-verifier round-trip.
#
# Proves, end to end and with real ed25519, that a receipt emitted by the
# gateway binary's shipped signing path verifies against the independent
# verifier binary — and that tampered / non-certified / wrong-key variants are
# rejected. This is the evidence for the historically-open §7.5 gap ("gateway
# receipts cannot verify against the independent verifier").
#
# Hermetic: emit-receipt performs NO network execution; it exercises the same
# build_certified_receipt() path the socket handler uses. Run inside rust:1-slim
# (see run_in_docker.sh) or any host with a Rust toolchain.
#
# Exit 0 iff every expectation holds.

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
line(){ printf '%s\n' "------------------------------------------------------------"; }
ok(){   PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad(){  FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$1"; }

echo "Ghost-Ark DAB Tier-0 round-trip"
echo "gateway  = $DAB/gateway"
echo "verifier = $DAB/verifier"
line

echo "[build] release binaries"
( cd "$DAB/gateway"  && cargo build --release --locked --quiet )
( cd "$DAB/verifier" && cargo build --release --locked --quiet )
GATEWAY="$DAB/gateway/target/release/dab-gateway"
VERIFIER="$DAB/verifier/target/release/dab-verifier"
echo "gateway  bin: $GATEWAY"
echo "verifier bin: $VERIFIER"
line

# Deterministic inputs -> reproducible artifacts.
PAYLOAD_B64="$(printf 'hello-ghost-ark' | base64)"
NONCE="nonce-roundtrip-001"
TS="0"

# ---- 1. CERTIFIED receipt verifies ----------------------------------------
echo "[1] emit CERTIFIED receipt and verify"
"$GATEWAY" emit-receipt --payload-b64 "$PAYLOAD_B64" --nonce "$NONCE" \
  --timestamp "$TS" --pubkey-out "$WORK/gateway.pub" \
  > "$WORK/certified.json" 2> "$WORK/pubkey.stderr"
cat "$WORK/certified.json"
PUBKEY="$(cat "$WORK/gateway.pub")"
echo "gateway_public_key = $PUBKEY"
if "$VERIFIER" "$WORK/certified.json" "$PUBKEY" ; then
  ok "certified receipt -> VERIFIED"
else
  bad "certified receipt should have verified"
fi
line

# ---- 2. Tampered receipt is rejected --------------------------------------
echo "[2] tamper policy_digest, expect REJECTED"
sed 's/"policy_digest":"[^"]*"/"policy_digest":"sha256:ATTACKER"/' \
  "$WORK/certified.json" > "$WORK/tampered.json"
if "$VERIFIER" "$WORK/tampered.json" "$PUBKEY" ; then
  bad "tampered receipt should NOT have verified"
else
  ok "tampered receipt -> REJECTED (exit $?)"
fi
line

# ---- 3. Mutation halt is not certifiable ----------------------------------
echo "[3] emit --mutate (c_i != c_e), expect MUTATION_DETECTED_HALT + REJECTED"
"$GATEWAY" emit-receipt --payload-b64 "$PAYLOAD_B64" --nonce "$NONCE" \
  --timestamp "$TS" --mutate > "$WORK/mutated.json" 2>/dev/null
grep -q 'MUTATION_DETECTED_HALT' "$WORK/mutated.json" \
  && ok "gateway emitted MUTATION_DETECTED_HALT" \
  || bad "expected MUTATION_DETECTED_HALT status"
if "$VERIFIER" "$WORK/mutated.json" "$PUBKEY" ; then
  bad "mutation receipt should NOT have verified"
else
  ok "mutation receipt -> REJECTED (exit $?)"
fi
line

# ---- 4. Wrong public key is rejected --------------------------------------
echo "[4] verify certified receipt with a DIFFERENT key, expect REJECTED"
WRONGKEY="$(DAB_GATEWAY_DEV_SEED_HEX=$(printf '%064x' 7) "$GATEWAY" \
  emit-receipt --payload-b64 "$PAYLOAD_B64" --nonce n --timestamp 0 \
  --pubkey-out "$WORK/wrong.pub" >/dev/null 2>&1; cat "$WORK/wrong.pub")"
echo "wrong_public_key = $WRONGKEY"
if [ "$WRONGKEY" = "$PUBKEY" ]; then
  bad "wrong key unexpectedly equals gateway key"
elif "$VERIFIER" "$WORK/certified.json" "$WRONGKEY" ; then
  bad "verification under wrong key should have failed"
else
  ok "wrong key -> REJECTED (exit $?)"
fi
line

echo "SUMMARY: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "ROUND-TRIP: OK" || { echo "ROUND-TRIP: FAILED"; exit 1; }
