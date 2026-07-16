//! Ghost-Ark DAB Tier-0 — bounded replay-window measurement.
//!
//! Turns the stated caveat ("the in-process tombstone set is capacity-bounded;
//! pruning at capacity reopens a theoretical replay window") into a *measured*
//! result. For each (capacity C, tombstones-created K) it drives the real
//! `ReplayLedger`, forces TTL archival + capacity prune, and counts how many
//! of the K consumed nonces are now replayable (no longer in ledger ∪ spent).
//!
//! A nonce is replayable iff `!exists(n)` — exactly the condition under which
//! `consume()` would accept it again. Uses TTL=0 so archival is immediate and
//! the boundary is deterministic in size (its membership is not: the prune is
//! HashSet-arbitrary, a second finding a production store must fix with
//! time-ordered eviction).
//!
//! Output: TSV to stdout (capacity, tombstones, retained, window,
//! expected_window, ok) plus a PASS/FAIL summary. No randomness, no network.

use dab_gateway::nonce::ReplayLedger;

fn measure_window(capacity: usize, tombstones: usize) -> usize {
    // TTL=0: every consumed nonce is immediately archival-eligible.
    let mut ledger = ReplayLedger::with_config(capacity, 0);

    let nonces: Vec<String> = (0..tombstones).map(|i| format!("n-{i}")).collect();
    for (i, n) in nonces.iter().enumerate() {
        // consume(nonce, transaction_id, commitment)
        let _ = ledger.consume(n.clone(), format!("tx-{i}"), format!("c-{i}"));
    }
    // Force the final archival + capacity prune so the boundary is clean.
    ledger.compact();

    // Replayable = originally-consumed nonces no longer tracked anywhere.
    nonces.iter().filter(|n| !ledger.exists(n)).count()
}

fn main() {
    // (capacity, tombstones_created) grid spanning below, at, and above cap.
    let configs = [
        // Dense C=8 sweep across the knee (for the paper figure), then larger
        // capacities to show the law holds at scale.
        (8usize, 1usize),
        (8, 2),
        (8, 4),
        (8, 8),
        (8, 12),
        (8, 16),
        (8, 24),
        (8, 32),
        (16, 100),
        (64, 200),
        (100, 1000),
    ];

    println!("# DAB Tier-0 bounded replay-window measurement");
    println!("# window = replayable nonces after capacity prune (TTL=0)");
    println!("capacity\ttombstones\tretained\twindow\texpected\tok");

    let mut all_ok = true;
    for (c, k) in configs {
        let window = measure_window(c, k);
        let retained = k - window;
        let expected = k.saturating_sub(c); // predicted law: max(0, K - C)
        let ok = window == expected;
        all_ok &= ok;
        println!(
            "{c}\t{k}\t{retained}\t{window}\t{expected}\t{}",
            if ok { "yes" } else { "NO" }
        );
    }

    println!();
    if all_ok {
        println!("LAW CONFIRMED: replay window = max(0, tombstones_created - capacity).");
        println!("Membership is HashSet-arbitrary (not age-ordered) — a production store");
        println!("must use time-ordered eviction. Capacity default is 500000 (env-tunable).");
    } else {
        println!("LAW NOT CONFIRMED — see rows marked NO above.");
        std::process::exit(1);
    }
}
