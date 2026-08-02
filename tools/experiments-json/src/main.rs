//! Experiment E11 arm: a `parse -> canonicalize -> digest` pipeline built
//! entirely from third-party code.
//!
//! Reads one raw JSON document on stdin and writes a single JSON line on stdout:
//!
//!   {"status":"digest","digest":"<hex>","canonicalForm":"<text>"}
//!   {"status":"rejected","reason":"<why>"}
//!
//! WHY THIS EXISTS
//!
//! Every arm of E1 that Ghost-Ark controls shares this repository's authorship,
//! and E5 already records that three verifiers written by one author from one
//! specification can share one misreading. E11 asks whether the ternary
//! soundness result survives contact with canonicalizers written by people who
//! never saw this project: serde_json here, Ruby's `JSON` alongside it, plus the
//! CPython and jq arms E1 and E7 already use.
//!
//! The canonicalization rule below is the ordinary one a competent engineer
//! reaches for -- parse, sort object keys, emit compact separators, digest the
//! UTF-8 bytes. It is deliberately NOT Ghost-Ark's canonicalizer. If the same
//! pathology classes collapse here, the kernel is a property of the problem
//! rather than of this repository's implementation.
//!
//! NON-CLAIM: this is a measurement arm, not a verifier, and not a
//! recommendation. It performs no signature, tenancy, or schema checking.

use std::io::Read;

use serde_json::Value;
use sha2::{Digest, Sha256};

/// Recursively rebuild the value with object keys in sorted order.
///
/// `serde_json` is built with `preserve_order`, so maps keep insertion order and
/// sorting has to be explicit. That is the point: key ordering is a decision
/// this arm makes for itself, exactly as an outside implementer would have to.
fn sort_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                out.insert(key.clone(), sort_keys(&map[key]));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(sort_keys).collect()),
        other => other.clone(),
    }
}

fn main() {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        println!("{{\"status\":\"rejected\",\"reason\":\"stdin was not valid UTF-8\"}}");
        return;
    }

    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            let reason = serde_json::to_string(&format!("serde_json parse: {error}"))
                .unwrap_or_else(|_| "\"serde_json parse error\"".to_string());
            println!("{{\"status\":\"rejected\",\"reason\":{reason}}}");
            return;
        }
    };

    let canonical = match serde_json::to_string(&sort_keys(&parsed)) {
        Ok(text) => text,
        Err(error) => {
            let reason = serde_json::to_string(&format!("serde_json serialize: {error}"))
                .unwrap_or_else(|_| "\"serde_json serialize error\"".to_string());
            println!("{{\"status\":\"rejected\",\"reason\":{reason}}}");
            return;
        }
    };

    let digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    let encoded = serde_json::to_string(&canonical).unwrap_or_else(|_| "\"\"".to_string());
    println!("{{\"status\":\"digest\",\"digest\":\"{digest}\",\"canonicalForm\":{encoded}}}");
}
