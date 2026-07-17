use std::collections::HashMap;
use std::sync::Arc;
use dashmap::DashMap;

#[derive(Debug, Default)]
pub struct VectorClock {
    pub clocks: DashMap<String, u64>,
}

impl Clone for VectorClock {
    fn clone(&self) -> Self {
        let new_clocks = DashMap::new();
        for kv in self.clocks.iter() {
            new_clocks.insert(kv.key().clone(), *kv.value());
        }
        Self { clocks: new_clocks }
    }
}

pub struct GlobalState {
    pub data: DashMap<String, String>,
    pub clock: VectorClock,
}

pub struct MvccEngine {
    state: Arc<GlobalState>,
}

impl Default for MvccEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl MvccEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(GlobalState {
                data: DashMap::new(),
                clock: VectorClock::default(),
            }),
        }
    }

    pub fn read_snapshot(&self) -> (HashMap<String, String>, VectorClock) {
        let mut snap = HashMap::new();
        for kv in self.state.data.iter() {
            snap.insert(kv.key().clone(), kv.value().clone());
        }
        (snap, self.state.clock.clone())
    }

    pub fn commit(&self, agent_id: &str, read_clock: &VectorClock, write_intent: &HashMap<String, String>) -> Result<(), String> {
        let mut conflict = false;
        
        // Check vector clock for concurrent interference
        for kv in self.state.clock.clocks.iter() {
            let id = kv.key();
            let tick = kv.value();
            let read_tick = read_clock.clocks.get(id).map(|r| *r.value()).unwrap_or(0);
            if id != agent_id && *tick > read_tick {
                conflict = true;
                break;
            }
        }

        if conflict {
            let mut colliding = false;
            for key in write_intent.keys() {
                if self.state.data.contains_key(key) {
                    colliding = true;
                    break;
                }
            }
            if colliding {
                return Err("Conflict detected on colliding keys (starvation)".to_string());
            }
        }

        // Apply writes to DashMap without global locks
        for (k, v) in write_intent {
            self.state.data.insert(k.clone(), v.clone());
        }

        // Atomic clock increment
        self.state.clock.clocks.entry(agent_id.to_string())
            .and_modify(|tick| *tick += 1)
            .or_insert(1);

        Ok(())
    }
}

// Step 3: In-Memory Partitioned Ledger communicating via mpsc
use std::sync::mpsc::Receiver;

pub struct LedgerNode {
    #[allow(dead_code)] // node identity retained for realism; not read by the bench
    id: usize,
    data: HashMap<String, String>,
}

impl LedgerNode {
    pub fn new(id: usize) -> Self {
        Self {
            id,
            data: HashMap::new(),
        }
    }

    pub fn process_receipts(&mut self, receiver: Receiver<(String, String)>) {
        for (k, v) in receiver {
            self.data.insert(k, v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;
    use std::thread;
    use std::sync::mpsc::channel;

    // Step 2: CPU-bound mathematical delay (simulating 45ms ZK SNARK verification)
    fn simulate_crypto_tax() {
        use sha2::{Sha256, Digest};
        let mut hash = Sha256::digest(b"ghost-ark-init");
        // Tune this loop to roughly hit 45ms depending on the CPU
        // We use 50,000 iterations to guarantee a measurable tax
        for _ in 0..50_000 {
            hash = Sha256::digest(hash);
        }
        // Force the optimizer not to throw away the hash
        let _val = hash[0]; 
    }

    #[test]
    fn step1_mvcc_concurrency_benchmark() {
        let engine = Arc::new(MvccEngine::new());
        let success_count = Arc::new(AtomicUsize::new(0));
        let conflict_count = Arc::new(AtomicUsize::new(0));
        let num_threads = 100;
        let ops_per_thread = 500;
        let total_ops = num_threads * ops_per_thread;
        
        let mut handles = vec![];
        
        // Pre-warm the threads and use a barrier if we wanted strict start, 
        // but just running them is fine.
        let start = Instant::now();
        
        for i in 0..num_threads {
            let engine_clone = Arc::clone(&engine);
            let success_clone = Arc::clone(&success_count);
            let conflict_clone = Arc::clone(&conflict_count);
            
            handles.push(thread::spawn(move || {
                let agent_id = format!("agent-{}", i);
                
                for j in 0..ops_per_thread {
                    let (_, read_clock) = engine_clone.read_snapshot();
                    
                    let mut intent = HashMap::new();
                    // Introduce artificial collisions
                    if (i + j) % 5 == 0 {
                        intent.insert("shared_config".to_string(), format!("val-{}-{}", i, j));
                    } else {
                        intent.insert(format!("agent_mem_{}", i), format!("val-{}-{}", i, j));
                    }

                    match engine_clone.commit(&agent_id, &read_clock, &intent) {
                        Ok(_) => { success_clone.fetch_add(1, Ordering::SeqCst); }
                        Err(_) => { conflict_clone.fetch_add(1, Ordering::SeqCst); }
                    }
                }
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }
        
        let elapsed = start.elapsed();
        let s = success_count.load(Ordering::SeqCst);
        let c = conflict_count.load(Ordering::SeqCst);
        
        println!("\n=== Step 1: DashMap MVCC Concurrency Benchmark ===");
        println!("Threads: {} ({} ops each)", num_threads, ops_per_thread);
        println!("Total Ops: {}", total_ops);
        println!("Elapsed Time: {:?}", elapsed);
        println!("Successful Commits: {}", s);
        println!("Starved (Conflicts): {}", c);
        println!("Throughput: {:.2} ops/sec", (total_ops as f64 / elapsed.as_secs_f64()));
        println!("==================================================\n");
        
        assert!(c > 0);
    }

    #[test]
    fn step2_cryptographic_tax_benchmark() {
        println!("\n=== Step 2: Cryptographic Tax Benchmark ===");
        let start = Instant::now();
        
        // We simulate verifying 10 sequential SNARK proofs
        for _ in 0..10 {
            simulate_crypto_tax();
        }
        
        let elapsed = start.elapsed();
        let avg_tax = elapsed.as_millis() / 10;
        println!("Total time for 10 sequential ZK checks: {:?}", elapsed);
        println!("Average simulated SNARK tax: {} ms", avg_tax);
        println!("===========================================\n");
        
        // Just prove it ran
        assert!(elapsed.as_millis() > 0);
    }

    #[test]
    fn step3_partitioned_ledger_sync() {
        let (tx1, rx1) = channel();
        let (tx2, rx2) = channel();
        let (tx3, rx3) = channel();

        // Node 1
        let handle1 = thread::spawn(move || {
            let mut node = LedgerNode::new(1);
            node.process_receipts(rx1);
            node.data.len()
        });

        // Node 2
        let handle2 = thread::spawn(move || {
            let mut node = LedgerNode::new(2);
            node.process_receipts(rx2);
            node.data.len()
        });

        // Node 3
        let handle3 = thread::spawn(move || {
            let mut node = LedgerNode::new(3);
            node.process_receipts(rx3);
            node.data.len()
        });

        println!("\n=== Step 3: Partitioned Ledger Eventual Consistency Benchmark ===");
        let num_receipts = 100_000;
        let start = Instant::now();

        for i in 0..num_receipts {
            let k = format!("tombstone-{}", i);
            let v = format!("hash-{}", i);
            
            // Replicate to all nodes
            tx1.send((k.clone(), v.clone())).unwrap();
            tx2.send((k.clone(), v.clone())).unwrap();
            tx3.send((k, v)).unwrap();
        }

        // Close channels so threads can finish
        drop(tx1);
        drop(tx2);
        drop(tx3);

        let count1 = handle1.join().unwrap();
        let count2 = handle2.join().unwrap();
        let count3 = handle3.join().unwrap();

        let elapsed = start.elapsed();

        println!("Receipts flooded: {}", num_receipts);
        println!("Node 1 synced: {}", count1);
        println!("Node 2 synced: {}", count2);
        println!("Node 3 synced: {}", count3);
        println!("Total Propagation Time: {:?}", elapsed);
        println!("Throughput: {:.2} messages/sec per node", (num_receipts as f64 / elapsed.as_secs_f64()));
        println!("===============================================================\n");

        assert_eq!(count1, num_receipts);
        assert_eq!(count2, num_receipts);
        assert_eq!(count3, num_receipts);
    }
}
