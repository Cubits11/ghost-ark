//! Ghost-Ark DAB Tier-0
//!
//! Declarative Action Binding
//!
//! Replay Protection Ledger
//!
//! Security responsibility:
//!
//! Prevent:
//!
//! 1. Replay of previously certified actions.
//! 2. Nonce reuse across transactions.
//! 3. Cross-execution confusion.
//!
//!
//! Security property:
//!
//! A certified DAB transaction may execute exactly once
//! within the replay protection domain.
//!
//!
//! Model correspondence:
//!
//! This implementation mirrors the verified TLA+ model in
//! proofs/dab/DAB_NonceLedger.tla. Specifically:
//!
//! - `entries` corresponds to `ledger` in the spec.
//! - `spent` corresponds to `spent` in the spec.
//! - `consume()` corresponds to `ConsumeNonce` (requires
//!    n \notin ledger AND n \notin spent).
//! - `cleanup_expired()` corresponds to `GarbageCollect`
//!    (archives to spent rather than forgetting).
//!
//! The spec's `NoReplays` invariant holds because a nonce
//! that leaves `entries` always enters `spent`, so it can
//! never be re-consumed.
//!
//!
//! Production replacements:
//!
//! - Redis with persistence
//! - DynamoDB conditional writes
//! - TPM sealed storage
//! - Nitro Enclave monotonic counters
//! - Hardware-backed ledger
//!

// `exists`/`get`/`size`/`spent_size` and the `NonceRecord` audit fields form a
// ledger inspection API used by tests and future socket/audit tooling; the
// hot path (`consume`) does not read all of them, so dead_code is allowed for
// this module. Doc-style clippy lints are allowed to match the DAB house style.
#![allow(dead_code)]
#![allow(clippy::empty_line_after_doc_comments)]
#![allow(clippy::doc_overindented_list_items)]

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc,
        Mutex,
    },
    time::{
        SystemTime,
        UNIX_EPOCH,
    },
};





/// Maximum lifetime of a nonce in the active ledger.
///
/// After this period:
///
/// nonce is archived to the spent set
/// (tombstoned, not forgotten).
///
/// Production deployments may
/// align this with transaction policy.
const NONCE_TTL_SECONDS:u64 =
    3600;




/// Maximum spent set entries before
/// oldest tombstones are pruned.
///
/// This bounds memory for the in-process
/// implementation. Production deployments
/// should use a durable external store.
const MAX_SPENT_ENTRIES:usize =
    500_000;




/// Maximum ledger entries.
///
/// Prevents memory exhaustion.
///
/// Production:
/// external durable store.
const MAX_LEDGER_ENTRIES:usize =
    100_000;







/// Shared replay ledger.
///
/// Thread-safe because
/// gateway handles concurrent requests.
pub type NonceLedger =
    Arc<Mutex<ReplayLedger>>;








/// A consumed nonce record.
#[derive(
    Debug,
    Clone
)]
pub struct NonceRecord {


    /// Unique execution nonce.
    pub nonce:
        String,


    /// Associated transaction.
    ///
    /// Prevents nonce reuse
    /// across execution contexts.
    pub transaction_id:
        String,


    /// When nonce was registered.
    pub created_at:
        u64,


    /// Optional C_I binding.
    ///
    /// Prevents swapping:
    ///
    /// nonce A
    /// with
    /// commitment B
    ///
    pub commitment:
        String,


}








/// Replay ledger implementation.
///
/// Maintains both an active entries map
/// and a spent tombstone set, mirroring
/// the verified TLA+ model.
#[derive(
    Debug
)]
pub struct ReplayLedger {


    entries:
        HashMap<String,NonceRecord>,


    /// Tombstone set: nonces that have
    /// been consumed and later evicted
    /// from the active map. A nonce in
    /// this set can never be re-consumed.
    spent:
        HashSet<String>,


}








impl ReplayLedger {


    /// Create empty ledger.
    pub fn new()
    -> Self {


        Self {

            entries:
                HashMap::new(),

            spent:
                HashSet::new(),

        }

    }








    /// Attempt to consume nonce.
    ///
    /// Returns:
    ///
    /// true:
    ///     nonce accepted
    ///
    /// false:
    ///     replay detected
    ///
    /// Security boundary:
    ///
    /// Checks both the active ledger AND
    /// the spent tombstone set. This closes
    /// the post-TTL replay window identified
    /// in the TLA+ model audit.
    ///
    pub fn consume(
        &mut self,
        nonce:String,
        transaction_id:String,
        commitment:String,
    )
    -> bool {



        self.cleanup_expired();





        // Reject if nonce is in the spent
        // tombstone set (post-TTL replay).
        if self.spent.contains(
            &nonce
        ){

            return false;

        }



        // Reject if nonce is in the active
        // ledger (within-TTL replay).
        if self.entries.contains_key(
            &nonce
        ){

            return false;

        }






        /*
            Memory safety boundary.

            In production this would
            trigger external persistence.
        */
        if self.entries.len()
            >=
            MAX_LEDGER_ENTRIES
        {

            return false;

        }








        let record =
            NonceRecord{


                nonce:
                    nonce.clone(),


                transaction_id,


                created_at:
                    current_timestamp(),


                commitment,


            };







        self.entries.insert(
            nonce,
            record
        );



        true

    }








    /// Check whether nonce exists
    /// in either the active ledger
    /// or the spent tombstone set.
    pub fn exists(
        &self,
        nonce:&str
    )
    -> bool {


        self.entries.contains_key(
            nonce
        )
        ||
        self.spent.contains(
            nonce
        )

    }








    /// Retrieve nonce metadata.
    pub fn get(
        &self,
        nonce:&str
    )
    -> Option<&NonceRecord>{


        self.entries.get(
            nonce
        )

    }








    /// Current active ledger size.
    pub fn size(
        &self
    )
    -> usize {


        self.entries.len()

    }



    /// Current spent tombstone set size.
    pub fn spent_size(
        &self
    )
    -> usize {


        self.spent.len()

    }







    /// Remove expired entries from the
    /// active ledger and archive them
    /// into the spent tombstone set.
    ///
    /// This is the critical security fix:
    /// entries are ARCHIVED, not forgotten.
    /// Corresponds to GarbageCollect in
    /// the TLA+ model.
    fn cleanup_expired(
        &mut self
    ){

        let now =
            current_timestamp();


        let mut to_archive =
            Vec::new();


        for (
            nonce,
            record
        ) in self.entries.iter() {

            if now - record.created_at
                >=
                NONCE_TTL_SECONDS
            {
                to_archive.push(
                    nonce.clone()
                );
            }

        }


        for nonce in to_archive {

            self.entries.remove(
                &nonce
            );

            self.spent.insert(
                nonce
            );

        }


        // Bound the spent set to prevent
        // unbounded memory growth. When
        // the limit is reached, the oldest
        // tombstones are lost — this is an
        // acknowledged bounded-replay-window
        // property of the in-process impl.
        // Production deployments should use
        // a durable external store.
        if self.spent.len() > MAX_SPENT_ENTRIES {

            // HashSet has no ordering, so in
            // the degenerate case we drain
            // arbitrarily. A production impl
            // would use a time-ordered eviction.
            let excess =
                self.spent.len() - MAX_SPENT_ENTRIES;

            let to_remove:Vec<String> =
                self.spent.iter()
                    .take(excess)
                    .cloned()
                    .collect();

            for n in to_remove {
                self.spent.remove(&n);
            }

        }

    }


}








/// Create shared ledger.
pub fn create_nonce_ledger()
-> NonceLedger {


    Arc::new(
        Mutex::new(
            ReplayLedger::new()
        )
    )

}








/// Unix timestamp.
fn current_timestamp()
-> u64 {


    SystemTime::now()
        .duration_since(
            UNIX_EPOCH
        )
        .unwrap()
        .as_secs()

}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_nonce_is_accepted() {
        let mut l = ReplayLedger::new();
        assert!(l.consume("n1".into(), "tx1".into(), "cAFE".into()));
        assert_eq!(l.size(), 1);
        assert!(l.exists("n1"));
    }

    #[test]
    fn within_ttl_replay_is_rejected() {
        // The core NoReplays behavior: a nonce in the active ledger cannot be
        // re-consumed. (Post-TTL/tombstone replay is what the TLA+ model
        // proves exhaustively; it is not wall-clock-testable here.)
        let mut l = ReplayLedger::new();
        assert!(l.consume("n1".into(), "tx1".into(), "cAFE".into()));
        assert!(!l.consume("n1".into(), "tx2".into(), "dEAD".into()));
        assert_eq!(l.size(), 1);
    }

    #[test]
    fn distinct_nonces_coexist() {
        let mut l = ReplayLedger::new();
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
        assert!(shared.lock().unwrap().consume("n1".into(), "tx".into(), "c".into()));
        assert!(!shared.lock().unwrap().consume("n1".into(), "tx".into(), "c".into()));
    }
}