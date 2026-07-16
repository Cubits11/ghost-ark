//! Ghost-Ark DAB Tier-0 — gateway receipt signing.
//!
//! DEV-ONLY ed25519 signer. This is **not** AWS KMS, HSM, TPM, or Nitro
//! attestation, and it makes no hardware-integrity claim. Its sole purpose is
//! to emit a *real* asymmetric signature over the canonical receipt message so
//! that receipts produced by this gateway verify against the independent
//! `dab-verifier` binary. Production key custody (KMS asymmetric keys addressed
//! by immutable key ARNs) is a separate, unimplemented concern.
//!
//! The previous signer emitted `DEV_SIGNATURE:<sha256>`, which the independent
//! verifier could never accept (it decodes a hex ed25519 signature over a
//! domain-separated message that includes `policy_digest`). This module closes
//! that gap by conforming the gateway to the verifier's contract.

use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

/// Domain-separation tag. MUST byte-match `SIGNATURE_DOMAIN` in the independent
/// verifier. Divergence here is exactly the historical round-trip gap.
pub const SIGNATURE_DOMAIN: &str = "GHOST-ARK:DAB:RECEIPT:";

/// Protocol version. MUST match the verifier's `PROTOCOL_VERSION`.
pub const PROTOCOL_VERSION: &str = "DAB-TIER0-V1";

/// Declared Tier-0 enforcement policy descriptor. `policy_digest()` binds a
/// receipt to *which* policy governed the decision. It does not assert the
/// policy is correct, complete, or safe.
pub const POLICY_DESCRIPTOR: &str =
    "GHOST-ARK:DAB:POLICY|v1|rule=exact-byte-consistency(c_i==c_e)|replay=nonce-monotonic-set";

/// Deterministic DEV seed used when `DAB_GATEWAY_DEV_SEED_HEX` is unset. DEV
/// ONLY — a fixed seed keeps locally reproduced round-trip artifacts stable. A
/// real deployment supplies key material out of band and never compiles a seed.
const DEV_SEED_HEX: &str =
    "0000000000000000000000000000000000000000000000000000000000000001";

/// SHA-256 policy digest, formatted `sha256:<hex>`.
pub fn policy_digest() -> String {
    let mut hasher = Sha256::new();
    hasher.update(POLICY_DESCRIPTOR.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// Canonical signed message. This is an *independent* copy of the verifier's
/// construction; the round-trip harness proves the two agree byte-for-byte,
/// preserving the differential-verification property rather than collapsing
/// both sides onto one shared implementation.
pub fn canonical_message(
    protocol: &str,
    c_i: &str,
    c_e: &str,
    nonce: &str,
    timestamp: &str,
    policy_digest: &str,
) -> String {
    format!(
        "{}{}|{}|{}|{}|{}|{}",
        SIGNATURE_DOMAIN, protocol, c_i, c_e, nonce, timestamp, policy_digest
    )
}

/// DEV-only ed25519 signing authority for the gateway.
pub struct GatewaySigner {
    key: SigningKey,
}

impl GatewaySigner {
    /// Load the DEV signing key from `DAB_GATEWAY_DEV_SEED_HEX` (64 hex chars)
    /// or fall back to the compiled DEV seed. DEV ONLY.
    pub fn from_dev_env() -> Result<Self, String> {
        let seed_hex = std::env::var("DAB_GATEWAY_DEV_SEED_HEX")
            .unwrap_or_else(|_| DEV_SEED_HEX.to_string());
        let seed_bytes = hex::decode(seed_hex.trim())
            .map_err(|_| "DAB_GATEWAY_DEV_SEED_HEX is not valid hex".to_string())?;
        let seed: [u8; 32] = seed_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "dev seed must be exactly 32 bytes (64 hex chars)".to_string())?;
        Ok(Self {
            key: SigningKey::from_bytes(&seed),
        })
    }

    /// Hex-encoded ed25519 public key. Hand this to the independent verifier.
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.key.verifying_key().to_bytes())
    }

    /// Sign the canonical receipt message; returns a hex-encoded ed25519
    /// signature (64 bytes -> 128 hex chars) that the verifier hex-decodes.
    pub fn sign_fields(
        &self,
        c_i: &str,
        c_e: &str,
        nonce: &str,
        timestamp: &str,
        policy_digest: &str,
    ) -> String {
        let message =
            canonical_message(PROTOCOL_VERSION, c_i, c_e, nonce, timestamp, policy_digest);
        let signature = self.key.sign(message.as_bytes());
        hex::encode(signature.to_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_key_is_deterministic() {
        let a = GatewaySigner::from_dev_env().unwrap().public_key_hex();
        let b = GatewaySigner::from_dev_env().unwrap().public_key_hex();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64); // 32-byte ed25519 public key
    }

    #[test]
    fn signature_is_hex_128() {
        let signer = GatewaySigner::from_dev_env().unwrap();
        let sig = signer.sign_fields("c", "c", "n", "0", &policy_digest());
        assert_eq!(sig.len(), 128); // 64-byte ed25519 signature
        assert!(hex::decode(&sig).is_ok());
    }

    #[test]
    fn canonical_message_matches_expected_shape() {
        let m = canonical_message("DAB-TIER0-V1", "ci", "ce", "n1", "0", "sha256:pd");
        assert_eq!(m, "GHOST-ARK:DAB:RECEIPT:DAB-TIER0-V1|ci|ce|n1|0|sha256:pd");
    }
}
