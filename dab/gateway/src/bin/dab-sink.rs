//! Ghost-Ark DAB Tier-0 — trivial HTTP sink for hermetic socket E2E tests.
//!
//! The gateway performs one authorized outbound POST (execute_request) on the
//! CERTIFIED path. This sink stands in for that external tool so the E2E test
//! needs no real network: it accepts any connection and returns 200 OK.
//!
//!   dab-sink [127.0.0.1:8080]
//!
//! Not part of the TCB and not shipped in production; test scaffolding only.

use std::io::{Read, Write};
use std::net::TcpListener;

fn main() {
    let addr = std::env::args().nth(1).unwrap_or_else(|| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&addr).expect("bind sink");
    eprintln!("dab-sink listening on {addr}");

    for mut stream in listener.incoming().flatten() {
        let mut buf = [0u8; 2048];
        let _ = stream.read(&mut buf); // best-effort drain of the request
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
    }
}
