//! Ghost-Ark DAB Tier-0 — minimal UNTRUSTED agent client.
//!
//! A real driver for the gateway's Unix-domain-socket boundary (the TypeScript
//! `dab/agent-runtime/` is a library with no entrypoint). It builds a declared
//! action commitment C_I from the payload bytes, sends a GatewayRequest over
//! /ipc/dab.sock, and prints the gateway's receipt. It is UNTRUSTED: it only
//! declares; the gateway independently derives C_E and decides.
//!
//!   dab-agent --payload-b64 <b64> --nonce <n> --target <url> [--mutate]
//!             [--socket /ipc/dab.sock]
//!
//! --mutate makes the declared C_I disagree with the payload bytes, so the
//! gateway must answer MUTATION_DETECTED_HALT.

use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use sha2::{Digest, Sha256};

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn arg_after(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let socket = arg_after(&args, "--socket").unwrap_or_else(|| "/ipc/dab.sock".into());
    let payload_b64 = arg_after(&args, "--payload-b64").unwrap_or_default();
    let nonce = arg_after(&args, "--nonce").unwrap_or_else(|| "n".into());
    let target = arg_after(&args, "--target").unwrap_or_else(|| "http://127.0.0.1:8080".into());
    let mutate = args.iter().any(|a| a == "--mutate");

    let payload_bytes = BASE64
        .decode(&payload_b64)
        .expect("--payload-b64 must be valid base64");

    // Honest declaration matches the bytes; --mutate forges a divergence so the
    // gateway's C_I == C_E check fails.
    let c_i = if mutate {
        sha256_bytes(b"__agent_mutated_declaration__")
    } else {
        sha256_bytes(&payload_bytes)
    };

    // Matches the gateway's GatewayRequest Deserialize schema.
    let request = format!(
        concat!(
            "{{\"protocol\":\"DAB-TIER0-V1\",\"version\":\"1\",\"c_i\":\"{}\",",
            "\"nonce\":\"{}\",\"target\":\"{}\",\"payload_encoding\":\"base64\",",
            "\"payload\":\"{}\",\"issued_at\":\"0\"}}"
        ),
        c_i, nonce, target, payload_b64
    );

    let mut stream = UnixStream::connect(&socket).expect("connect /ipc/dab.sock");
    stream.write_all(request.as_bytes()).expect("write request");
    // The gateway reads to EOF; half-close so it sees end-of-request.
    stream.shutdown(Shutdown::Write).expect("shutdown write half");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read receipt");
    print!("{response}");
    if !response.ends_with('\n') {
        println!();
    }
}
