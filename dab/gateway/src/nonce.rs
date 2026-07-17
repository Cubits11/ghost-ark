//! Ghost-Ark DAB Tier-0 — Replay Protection Ledger
//!
//! Security responsibility:
//! 1. Prevent replay of previously certified actions.
//! 2. Prevent nonce reuse across transactions.
//! 3. Maintain O(1) concurrent execution under heavy cryptographic load.
//!
//! Architecture:
//! Utilizes a sharded `DashMap` to eliminate global lock contention on the hot path. 
//! O(N) garbage collection is completely decoupled from the commit predicate and 
//! relegated to an asynchronous background OS thread. Hardware-level `AtomicUsize` 
//! counters track capacity bounds to prevent cross-shard cache-coherency storms.

#![allow(dead_code)]
#![allow(clippy::empty_line_after_doc_comments)]
#![allow(clippy::doc_overindented_list_items)]

use dashmap::{DashMap, DashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const NONCE_TTL_SECONDS: u64 = 3600;
const MAX_SPENT_ENTRIES: usize = 500_000;
const MAX_LEDGER_ENTRIES: usize = 100_000;

pub type NonceLedger = Arc<ReplayLedger>;

#[derive(Debug, Clone)]
pub struct NonceRecord {
    pub nonce: String,
    pub transaction_id: String,
    pub created_at: u64,
    pub commitment: String,
}

#[derive(Debug)]
pub struct ReplayLedger {
    entries: DashMap<String, NonceRecord>,
    spent: DashSet<String>,
    active_count: AtomicUsize,
    max_spent: usize,
    ttl_seconds: u64,
}

impl Default for ReplayLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl ReplayLedger {
    pub fn new() -> Self {
        let max_spent = std::env::var("DAB_MAX_SPENT_ENTRIES")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(MAX_SPENT_ENTRIES);

        let ttl_seconds = std::env::var("DAB_NONCE_TTL_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(NONCE_TTL_SECONDS);

        Self::with_config(max_spent, ttl_seconds)
    }

    pub fn with_config(max_spent: usize, ttl_seconds: u64) -> Self {
        Self {
            entries: DashMap::new(),
            spent: DashSet::new(),
            active_count: AtomicUsize::new(0),
            max_spent,
            ttl_seconds,
        }
    }

    /// O(1) concurrent commit path. 
    /// Explicitly devoid of garbage collection or global mutexes.
    pub fn consume(&self, nonce: String, transaction_id: String, commitment: String) -> bool {
        // 1. O(1) Tombstone Rejection (Post-TTL Replay)
        if self.spent.contains(&nonce) {
            return false;
        }

        // 2. O(1) Active Ledger Rejection (Within-TTL Replay)
        if self.entries.contains_key(&nonce) {
            return false;
        }

        // 3. Hardware Atomic Capacity Guard (Prevents cross-shard locking)
        if self.active_count.load(Ordering::Relaxed) >= MAX_LEDGER_ENTRIES {
            return false;
        }

        let record = NonceRecord {
            nonce: nonce.clone(),
            transaction_id,
            created_at: current_timestamp(),
            commitment,
        };

        // 4. Sharded Insertion
        if self.entries.insert(nonce.clone(), record).is_none() {
            self.active_count.fetch_add(1, Ordering::Relaxed);
        }

        true
    }

    pub fn exists(&self, nonce: &str) -> bool {
        self.entries.contains_key(nonce) || self.spent.contains(nonce)
    }

    pub fn get(&self, nonce: &str) -> Option<NonceRecord> {
        self.entries.get(nonce).map(|r| r.clone())
    }

    pub fn size(&self) -> usize {
        self.active_count.load(Ordering::Relaxed)
    }

    pub fn spent_size(&self) -> usize {
        self.spent.len()
    }

    /// Executed asynchronously by a background thread. 
    /// Removes expired entries to `spent` and prunes capacity.
    pub fn run_garbage_collection(&self) {
        let now = current_timestamp();
        let mut to_archive = Vec::new();

        // 1. Identify expired nonces
        for entry in self.entries.iter() {
            if now - entry.created_at >= self.ttl_seconds {
                to_archive.push(entry.key().clone());
            }
        }

        // 2. Move to tombstones and decrement atomic counter
        let mut archived_count = 0;
        for nonce in to_archive {
            if self.entries.remove(&nonce).is_some() {
                self.spent.insert(nonce);
                archived_count += 1;
            }
        }

        if archived_count > 0 {
            self.active_count.fetch_sub(archived_count, Ordering::Relaxed);
        }

        // 3. Enforce tombstone capacity
        if self.spent.len() > self.max_spent {
            let excess = self.spent.len() - self.max_spent;
            let to_remove: Vec<String> = self.spent.iter()
                .take(excess)
                .map(|e| e.key().clone())
                .collect();

            for n in to_remove {
                self.spent.remove(&n);
            }
        }
    }
}

pub fn create_nonce_ledger() -> NonceLedger {
    Arc::new(ReplayLedger::new())
}

fn current_timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_nonce_is_accepted() {
        let l = ReplayLedger::new();
        assert!(l.consume("n1".into(), "tx1".into(), "cAFE".into()));
        assert_eq!(l.size(), 1);
        assert!(l.exists("n1"));
    }

    #[test]
    fn within_ttl_replay_is_rejected() {
        let l = ReplayLedger::new();
        assert!(l.consume("n1".into(), "tx1".into(), "cAFE".into()));
        assert!(!l.consume("n1".into(), "tx2".into(), "dEAD".into()));
        assert_eq!(l.size(), 1);
    }

    #[test]
    fn distinct_nonces_coexist() {
        let l = ReplayLedger::new();
        assert!(l.consume("n1".into(), "tx1".into(), "c1".into()));
        assert!(l.consume("n2".into(), "tx2".into(), "c2".into()));
        assert_eq!(l.size(), 2);
        assert!(l.get("n1").is_some());
        assert_eq!(l.get("n1").unwrap().commitment, "c1");
        assert_eq!(l.spent_size(), 0);
    }

    #[test]
    fn create_nonce_ledger_shares_state() {
        let shared = create_nonce_ledger();
        assert!(shared.consume("n1".into(), "tx".into(), "c".into()));
        assert!(!shared.consume("n1".into(), "tx".into(), "c".into()));
    }
}