//! Ghost-Ark DAB Tier-0 — independent verifier CLI.
//!
//! Thin wrapper around `dab_verifier::verify_dab_receipt`. It reads a receipt
//! JSON file and an ed25519 public key (hex, inline or as a file path), and
//! prints a single verdict line with a process exit code:
//!
//!   exit 0  -> VERIFIED
//!   exit 1  -> REJECTED: <reason>   (a real verification failure)
//!   exit 2  -> usage / IO error     (could not even attempt verification)
//!
//! The verifier trusts only the public key it is handed and the deterministic
//! evidence in the receipt. It does not trust the gateway that produced it.

use std::process::exit;

use dab_verifier::verify_dab_receipt;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() != 3 {
        eprintln!("usage: dab-verifier <receipt.json> <pubkey_hex_or_file>");
        exit(2);
    }

    let receipt_json = match std::fs::read_to_string(&args[1]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot read receipt {}: {e}", args[1]);
            exit(2);
        }
    };

    // Accept the public key either inline (hex) or as a path to a hex file.
    let pk_arg = &args[2];
    let pk_hex = std::fs::read_to_string(pk_arg)
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| pk_arg.trim().to_string());

    let pk_bytes = match hex::decode(&pk_hex) {
        Ok(b) => b,
        Err(_) => {
            eprintln!("public key is not valid hex");
            exit(2);
        }
    };

    match verify_dab_receipt(&receipt_json, &pk_bytes) {
        Ok(true) => {
            println!("VERIFIED");
            exit(0);
        }
        Ok(false) => {
            // verify_dab_receipt returns Ok(true) or Err on this path; this
            // arm exists only for exhaustiveness.
            println!("REJECTED: verification returned false");
            exit(1);
        }
        Err(e) => {
            println!("REJECTED: {e:?}");
            exit(1);
        }
    }
}
