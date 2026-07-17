//! Ghost-Ark DAB Tier-0 gateway library.
//!
//! Exposes the replay ledger (`nonce`) and receipt-signing primitives
//! (`signing`) so they are reusable by the gateway binary, the replay-window
//! measurement (`dab-replay-stress`), and unit tests — rather than being
//! private modules of the binary crate.
#![allow(clippy::empty_line_after_doc_comments)]

pub mod nonce;
pub mod signing;
pub mod phase1;
pub mod v200;
