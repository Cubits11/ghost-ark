# Phase 1: Empirical Claims

This document formally records the empirical performance and concurrency bounds of Ghost-Ark's Phase 1 architecture under native Rust benchmarking.

## Claim 1: Multi-Threaded MVCC Contention

**Claim:** Ghost-Ark's OCC Gate resolves read-write collisions and auto-merges intents under native multi-threaded contention (1,000+ parallel threads).
**Maturity:** L3 unit-tested primitive.
**Scope:** `dab/` workspace Rust native runtime. 
**Evidence:** The benchmark `step1_mvcc_concurrency_benchmark` in `dab/gateway/src/phase1.rs`.
**Verification command:** `cd dab/gateway && cargo test --release step1_mvcc_concurrency_benchmark -- --nocapture`
**Assumptions:** Lock-free structures or standard library `RwLock` primitives correctly isolate state across native OS threads.
**Non-claims:** This does not prove full distributed multi-node transactional consensus, only local concurrent in-memory synchronization.
**Known gaps:** Currently benchmarks lock-free state maps against high-contention keys, but network I/O serialization is not factored into this specific microbenchmark.
**Last validated:** 2026-07-17

## Claim 2: Simulated Cryptographic Tax Throughput

**Claim:** The validation pipeline maintains target throughput under a simulated 16ms cryptographic verification tax (representing a zero-knowledge SNARK proof check).
**Maturity:** L3 unit-tested primitive.
**Scope:** `dab/` workspace Rust native runtime.
**Evidence:** The benchmark `step2_cryptographic_tax_benchmark` in `dab/gateway/src/phase1.rs`.
**Verification command:** `cd dab/gateway && cargo test --release step2_cryptographic_tax_benchmark -- --nocapture`
**Assumptions:** Real zkVM receipt verification (e.g., RISC Zero or SP1) will map relatively predictably to a heavy CPU-bound hashing workload.
**Non-claims:** This does not claim integration with a live ZK prover, nor does it guarantee constant-time verification for arbitrarily large proofs.
**Known gaps:** We simulate the tax; we have not yet integrated the actual RISC Zero/SP1 crates.
**Last validated:** 2026-07-17

## Claim 3: Partitioned Ledger Eventual Consistency

**Claim:** The Ledger Gate maintains replay-blocking state via eventual consistency (channel propagation) without a bounded local tombstone limit.
**Maturity:** L3 unit-tested primitive.
**Scope:** `dab/` workspace Rust native runtime via local `mpsc` channels.
**Evidence:** The benchmark `step3_partitioned_ledger_sync` in `dab/gateway/src/phase1.rs`.
**Verification command:** `cd dab/gateway && cargo test --release step3_partitioned_ledger_sync -- --nocapture`
**Assumptions:** Eventual consistency across local channels approximates the synchronization latency of a lightweight consensus protocol or distributed KV store.
**Non-claims:** This does not claim byzantine fault tolerance (BFT) or real network resilience against dropped packets/partitions.
**Known gaps:** Channel latency does not perfectly match network latency or serialization/deserialization overhead.
**Last validated:** 2026-07-17
