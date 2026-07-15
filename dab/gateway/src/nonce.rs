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
//! Production replacements:
//!
//! - Redis with persistence
//! - DynamoDB conditional writes
//! - TPM sealed storage
//! - Nitro Enclave monotonic counters
//! - Hardware-backed ledger
//!



use std::{
    collections::HashMap,
    sync::{
        Arc,
        Mutex,
    },
    time::{
        SystemTime,
        UNIX_EPOCH,
    },
};





/// Maximum lifetime of a nonce.
///
/// After this period:
///
/// nonce may be garbage collected.
///
/// Production deployments may
/// align this with transaction policy.
const NONCE_TTL_SECONDS:u64 =
    3600;





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
#[derive(
    Debug
)]
pub struct ReplayLedger {


    entries:
        HashMap<String,NonceRecord>,


}









impl ReplayLedger {


    /// Create empty ledger.
    pub fn new()
    -> Self {


        Self {

            entries:
                HashMap::new(),

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
    pub fn consume(
        &mut self,
        nonce:String,
        transaction_id:String,
        commitment:String,
    )
    -> bool {



        self.cleanup_expired();





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








    /// Check whether nonce exists.
    pub fn exists(
        &self,
        nonce:&str
    )
    -> bool {


        self.entries.contains_key(
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








    /// Current ledger size.
    pub fn size(
        &self
    )
    -> usize {


        self.entries.len()

    }








    /// Remove expired entries.
    ///
    /// Prevents infinite growth.
    fn cleanup_expired(
        &mut self
    ){

        let now =
            current_timestamp();



        self.entries.retain(
            |
                _,
                record
            |{


                now
                -
                record.created_at
                <
                NONCE_TTL_SECONDS


            }
        );

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