//! Ghost-Ark TCB Concurrent Stress Test
//!
//! This bypasses the Node.js FFI boundary to measure the true hardware limits,
//! concurrent-admission contention (lock-free sharded DashSet ledger), and real
//! ed25519 cryptographic overhead of the Rust Gateway. Unlike the in-process
//! TypeScript micro-benchmark (dab/bench/performance.ts), which times a SHA-256
//! commitment-digest cycle single-threaded, this measures wall-clock throughput
//! of NUM_THREADS workers doing real replay-admission + real ed25519 signing.
//!
//! Two phases, because the ledger fail-closes at capacity
//! (MAX_LEDGER_ENTRIES = 100_000) and an honest load test must not blend the
//! two regimes into one meaningless average:
//!
//!   Phase A (within capacity): every op is a fresh nonce; admission succeeds
//!     and the op pays for a real ed25519 signature. Reports the sustained
//!     admission+signing throughput.
//!   Phase B (at capacity):     the ledger is full; every fresh nonce is
//!     rejected by the atomic capacity guard before any crypto. Reports the
//!     fail-closed rejection throughput (the cost of saying no).
//!
//! The harness is two-sided: it exits non-zero if Phase A rejects anything or
//! Phase B accepts anything, so a regression in either regime cannot pass
//! silently. No network, no sockets: this is the TCB's in-process ceiling, an
//! upper bound the socketed gateway cannot exceed.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
use dab_gateway::nonce::create_nonce_ledger;
use dab_gateway::signing::{policy_digest, GatewaySigner};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

const NUM_THREADS: usize = 64;
/// Phase A: 64 x 1_500 = 96_000 ops, safely under MAX_LEDGER_ENTRIES (100_000).
const A_OPS_PER_THREAD: usize = 1_500;
/// Phase B: 64 x 2_000 = 128_000 attempts against a full ledger.
const B_OPS_PER_THREAD: usize = 2_000;

fn main() {
    let ledger = create_nonce_ledger();
    let signer = Arc::new(GatewaySigner::from_dev_env().expect("Failed to load signer"));
    let p_digest = policy_digest();

    println!("Ghost-Ark TCB Concurrent Stress Test (two-phase, fail-closed aware)");
    println!(
        "threads={NUM_THREADS} phaseA_ops={} phaseB_ops={}",
        NUM_THREADS * A_OPS_PER_THREAD,
        NUM_THREADS * B_OPS_PER_THREAD
    );

    // ---- Phase A: within capacity (admission + real ed25519 signing) ----
    let start_a = Instant::now();
    let mut handles = vec![];
    for t in 0..NUM_THREADS {
        let ledger_clone = Arc::clone(&ledger);
        let signer_clone = Arc::clone(&signer);
        let p_digest_clone = p_digest.clone();
        handles.push(thread::spawn(move || {
            let mut accepted = 0usize;
            for i in 0..A_OPS_PER_THREAD {
                let nonce = format!("a-{t}-{i}");
                let tx_id = format!("tx-{t}");
                let commitment = format!("c_i-{t}-{i}");
                let timestamp = "1710000000"; // fixed: latency of signing, not clock reads

                // Lock-free admission: consume() takes &self on the sharded
                // DashSet ledger; there is no global mutex to serialize on.
                if ledger_clone.consume(nonce.clone(), tx_id, commitment.clone()) {
                    // Real ed25519 signature over the canonical receipt message.
                    let _sig = signer_clone.sign_fields(
                        &commitment,
                        &commitment,
                        &nonce,
                        timestamp,
                        &p_digest_clone,
                    );
                    accepted += 1;
                }
            }
            accepted
        }));
    }
    let accepted_a: usize = handles.into_iter().map(|h| h.join().unwrap()).sum();
    let dur_a = start_a.elapsed();
    let attempted_a = NUM_THREADS * A_OPS_PER_THREAD;
    let ops_sec_a = accepted_a as f64 / dur_a.as_secs_f64();

    // ---- Top-up: fill the ledger to exact capacity, single-threaded ----
    let mut topped = 0usize;
    while ledger.consume(
        format!("topup-{topped}"),
        "tx-topup".into(),
        "c-topup".into(),
    ) {
        topped += 1;
    }

    // ---- Phase B: at capacity (fail-closed rejection path, no crypto) ----
    let start_b = Instant::now();
    let mut handles = vec![];
    for t in 0..NUM_THREADS {
        let ledger_clone = Arc::clone(&ledger);
        handles.push(thread::spawn(move || {
            let mut accepted = 0usize;
            for i in 0..B_OPS_PER_THREAD {
                let nonce = format!("b-{t}-{i}");
                if ledger_clone.consume(nonce, format!("tx-{t}"), "c_b".into()) {
                    accepted += 1;
                }
            }
            accepted
        }));
    }
    let accepted_b: usize = handles.into_iter().map(|h| h.join().unwrap()).sum();
    let dur_b = start_b.elapsed();
    let attempted_b = NUM_THREADS * B_OPS_PER_THREAD;
    let rej_sec_b = (attempted_b - accepted_b) as f64 / dur_b.as_secs_f64();

    println!("========================================");
    println!(
        "Phase A (within capacity): {accepted_a}/{attempted_a} accepted in {:.3?} -> {:.0} ops/sec (admission + real ed25519 sign)",
        dur_a, ops_sec_a
    );
    println!(
        "Top-up to capacity: +{topped} (active = {})",
        ledger.size()
    );
    println!(
        "Phase B (fail-closed at capacity): {accepted_b}/{attempted_b} accepted in {:.3?} -> {:.0} rejections/sec",
        dur_b, rej_sec_b
    );
    println!("========================================");

    // Two-sided oracle: a harness that cannot fail cannot be trusted.
    let mut ok = true;
    if accepted_a != attempted_a {
        println!("FAIL: Phase A rejected {} in-capacity ops", attempted_a - accepted_a);
        ok = false;
    }
    if accepted_b != 0 {
        println!("FAIL: Phase B accepted {accepted_b} ops past the capacity guard");
        ok = false;
    }
    if ok {
        println!("SANITY OK: in-capacity all accepted; at-capacity all rejected (fail-closed).");
    } else {
        std::process::exit(1);
    }
}
