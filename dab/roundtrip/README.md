# DAB Tier-0 — Gateway ↔ Independent-Verifier Round-Trip

This directory closes the historically-open gap recorded in
[`docs/artifact/repository_inventory.md`](../../docs/artifact/repository_inventory.md)
§7.5: *"gateway-emitted receipts cannot verify against the independent
verifier."*

## What it proves

The `dab-gateway` binary and the independent `dab-verifier` binary now agree on
a real ed25519 signature over a domain-separated canonical message that
includes `policy_digest`. The harness records four checks:

| # | Input | Expected | Result |
|---|-------|----------|--------|
| 1 | CERTIFIED receipt from the gateway's shipped signing path | `VERIFIED` | ✅ |
| 2 | Same receipt with `policy_digest` tampered | `REJECTED: InvalidSignature` | ✅ |
| 3 | `--mutate` (declared `c_i` ≠ derived `c_e`) | `MUTATION_DETECTED_HALT`, then `REJECTED: InvalidStatus` | ✅ |
| 4 | CERTIFIED receipt verified under a different public key | `REJECTED: InvalidSignature` | ✅ |

The recorded transcript is [`RECORDED_ROUNDTRIP.txt`](RECORDED_ROUNDTRIP.txt).
Because the gateway uses a **fixed DEV ed25519 seed**, the public key
(`4cb5abf6…`), signature, and digests are deterministic and reproduce exactly.

## Run it

```bash
bash dab/roundtrip/run_in_docker.sh     # pinned rust:1-slim, no host toolchain
# or, with a host Rust toolchain:
bash dab/roundtrip/run_roundtrip.sh
```

Both the gateway and verifier also carry `cargo test` unit evidence
(gateway: signer determinism + signature shape; verifier: a signed receipt
verifies, and commitment-mismatch / tampered-field / wrong-key / non-certified
variants are each rejected with the specific error).

## What changed to close the gap

- The gateway's live certified-receipt path (`build_certified_receipt` in
  [`gateway/src/main.rs`](../gateway/src/main.rs), signing in
  [`gateway/src/signing.rs`](../gateway/src/signing.rs)) now emits a
  `policy_digest` and a **real hex ed25519 signature** over the verifier's
  exact canonical message. It previously emitted `DEV_SIGNATURE:<sha256>` with
  no `policy_digest`, which the verifier could never accept.
- The verifier crate (`Cargo.toml` was empty; it had no `fn main`) is now a
  proper `lib` + CLI `bin`. The verification **logic is unchanged** — the fix
  conformed the gateway to the verifier's contract, never the reverse.
- `Cargo.lock` files are committed for both crates, so `cargo build --locked`
  works (previously impossible — no lockfiles existed).

## Scope and non-claims

- The signing key is a **local DEV ed25519 key**, not AWS KMS, HSM, TPM, or
  Nitro attestation. This closes *"gateway receipts verify against the
  independent verifier"* — **not** production key custody or hardware
  integrity. KMS asymmetric keys addressed by immutable ARNs remain the
  intended, unimplemented production posture.
- `emit-receipt` is hermetic (no network execution); it exercises the same
  `build_certified_receipt` path the socket handler uses. The full
  socket/container/k8s runtime path is demonstrated separately under
  [`dab/k8s/`](../k8s/).
- `c_e` is a SHA-256 of the payload bytes: a byte-consistency check, not a
  semantic judgment. `policy_digest` binds *which* Tier-0 policy governed the
  decision; it does not assert the policy is correct, complete, or safe.
