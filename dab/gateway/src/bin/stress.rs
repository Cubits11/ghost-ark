//! Ghost-Ark TCB Concurrent Stress Test
//! 
//! This bypasses the Node.js FFI boundary to measure the true hardware limits,
//! concurrent-admission contention (lock-free sharded DashSet ledger), and real
//! ed25519 cryptographic overhead of the Rust Gateway. Unlike the in-process
//! TypeScript micro-benchmark (dab/bench/performance.ts), which times a SHA-256
//! commitment-digest cycle single-threaded, this measures wall-clock throughput
//! of NUM_THREADS workers doing real replay-admission + real ed25519 signing.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
use dab_gateway::nonce::create_nonce_ledger;
use dab_gateway::signing::{GatewaySigner, policy_digest};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

const NUM_THREADS: usize = 64;
const OPS_PER_THREAD: usize = 10_000; // 640k total ops

fn main() {
    let ledger = create_nonce_ledger();
    let signer = Arc::new(GatewaySigner::from_dev_env().expect("Failed to load signer"));
    let p_digest = policy_digest();

    println!("Starting Ghost-Ark TCB Stress Test...");
    println!("Threads: {}, Ops/Thread: {}, Total Ops: {}", NUM_THREADS, OPS_PER_THREAD, NUM_THREADS * OPS_PER_THREAD);

    let start = Instant::now();
    let mut handles = vec![];

    for t in 0..NUM_THREADS {
        let ledger_clone = Arc::clone(&ledger);
        let signer_clone = Arc::clone(&signer);
        let p_digest_clone = p_digest.clone();

        handles.push(thread::spawn(move || {
            let mut success_count = 0;
            
            for i in 0..OPS_PER_THREAD {
                let nonce = format!("nonce-{}-{}", t, i);
                let tx_id = format!("tx-{}", t);
                let commitment = format!("c_i-{}-{}", t, i);
                let timestamp = "1710000000"; // Mock timestamp

                // 1. Lock-free replay admission. nonce.rs was refactored from
                //    Arc<Mutex<ReplayLedger>> to a sharded DashSet, so consume()
                //    takes &self and needs no external lock — that is the point of
                //    the refactor: there is no global mutex to serialize on.
                let accepted = ledger_clone.consume(nonce.clone(), tx_id, commitment.clone());

                if accepted {
                    // 2. Heavy Cryptography (ed25519) outside the lock
                    let _sig = signer_clone.sign_fields(
                        &commitment, 
                        &commitment, 
                        &nonce, 
                        timestamp, 
                        &p_digest_clone
                    );
                    success_count += 1;
                }
            }
            success_count
        }));
    }

    let mut total_success = 0;
    for handle in handles {
        total_success += handle.join().unwrap();
    }

    let duration = start.elapsed();
    let ops_per_sec = (total_success as f64) / duration.as_secs_f64();

    println!("========================================");
    println!("Total Time: {:.2?}", duration);
    println!("Successful Ops: {}", total_success);
    println!("True Throughput: {:.2} ops/sec", ops_per_sec);
    println!("========================================");
}