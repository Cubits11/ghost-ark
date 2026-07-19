// The DAB sources use a deliberately airy doc style (blank lines after `///`).
// That formatting choice is not a defect, so its stylistic clippy lint is
// allowed crate-wide. Correctness/complexity lints remain enforced.
#![allow(clippy::empty_line_after_doc_comments)]

/**
 * Ghost-Ark DAB Tier-0
 *
 * Declarative Action Binding
 *
 * Trusted Gateway Enforcement Boundary
 *
 * Responsibilities:
 *
 * 1. Receive declaration from untrusted runtime
 * 2. Independently compute C_E
 * 3. Enforce C_I == C_E
 * 4. Prevent replay
 * 5. Execute only certified bytes
 * 6. Produce signed receipt
 *
 *
 * This module is the Trusted Computing Base.
 *
 */

use std::{
    io::{Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    time::{SystemTime, UNIX_EPOCH},
};


use serde::{
    Deserialize,
    Serialize,
};


use sha2::{
    Digest,
    Sha256,
};


// nonce/signing now live in the gateway library (src/lib.rs) so they are
// shared with the replay-window measurement and tests.
use dab_gateway::signing::{
    GatewaySigner,
    policy_digest,
};

// The replay ledger is the TLC-verified spent-tombstone model (nonce.rs),
// wired into the running gateway (previously the binary used an inline
// HashSet with no TTL/tombstone semantics).
use dab_gateway::nonce::{self, NonceLedger};

use std::sync::Arc as StdArc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;




const SOCKET_PATH:&str =
    "/ipc/dab.sock";


const MAX_REQUEST_BYTES:usize =
    1024 * 1024;



const PROTOCOL_VERSION:&str =
    "DAB-TIER0-V1";





// NonceLedger is now nonce::NonceLedger (Arc<ReplayLedger> over a lock-free
// sharded DashSet), imported above. The verified tombstone model governs replay
// protection; see nonce.rs.







// `version`, `payload_encoding`, and `issued_at` are received as part of the
// agent's wire schema and recorded, but the Tier-0 gateway does not branch on
// them (payload is assumed base64; ordering lives in the nonce, not issued_at).
// They are retained so the request shape stays stable and auditable.
#[allow(dead_code)]
#[derive(Debug,Deserialize)]
struct GatewayRequest {


    protocol:String,


    version:String,


    c_i:String,


    nonce:String,


    target:String,


    payload_encoding:String,


    payload:String,


    issued_at:String,

}








#[derive(Debug,Serialize)]
struct GatewayReceipt {


    protocol:String,


    status:String,


    c_i:String,


    c_e:String,


    nonce:String,


    timestamp:String,


    /// Binds the receipt to the enforcing policy. Part of the signed message;
    /// the independent verifier requires it.
    policy_digest:String,


    gateway_signature:String,

}









// Some variants are reserved for the structured-error refactor of the socket
// handler (which currently writes receipts inline); keep them documented rather
// than silently dropped.
#[allow(dead_code)]
#[derive(Debug)]
enum GatewayError {


    InvalidRequest(String),


    ReplayDetected,


    MutationDetected,


    ExecutionFailed,


}










fn sha256_bytes(
    bytes:&[u8]
)->String {


    let mut hasher =
        Sha256::new();


    hasher.update(bytes);


    format!(
        "sha256:{:x}",
        hasher.finalize()
    )

}








fn now_timestamp()->String {


    let now =
        SystemTime::now()
        .duration_since(
            UNIX_EPOCH
        )
        .unwrap()
        .as_secs();


    now.to_string()

}








/*
    Build a CERTIFIED receipt and sign it with the gateway's DEV ed25519 key
    over the canonical, domain-separated message the independent verifier
    checks. This is the ONLY certified-receipt construction path; the socket
    handler and the one-shot `emit-receipt` mode both call it, so recorded
    round-trip evidence exercises exactly the shipped signing code.

    DEV key custody only — not KMS/HSM/TPM/Nitro. See src/signing.rs.
*/
fn build_certified_receipt(
    signer:&GatewaySigner,
    c_i:String,
    c_e:String,
    nonce:String,
    timestamp:String,
)->GatewayReceipt {


    let pd =
        policy_digest();


    let signature =
        signer.sign_fields(
            &c_i,
            &c_e,
            &nonce,
            &timestamp,
            &pd,
        );


    GatewayReceipt{

        protocol:
            PROTOCOL_VERSION.into(),

        status:
            "CERTIFIED".into(),

        c_i,

        c_e,

        nonce,

        timestamp,

        policy_digest:
            pd,

        gateway_signature:
            signature,

    }

}









fn decode_payload(
    encoded:&str
)->Result<Vec<u8>,GatewayError>{


    BASE64.decode(encoded)
        .map_err(
            |_| GatewayError::InvalidRequest(
                "Invalid base64 payload"
                .into()
            )
        )

}









fn execute_request(
    req:&GatewayRequest
)
->Result<(),GatewayError>{


    /*
        IMPORTANT:

        Network execution happens ONLY here.

        Every earlier check must pass.
    */


    reqwest::blocking::Client::builder()
        .timeout(
            std::time::Duration::from_secs(10)
        )
        .build()
        .unwrap()
        .post(
            &req.target
        )
        .body(
            req.payload.clone()
        )
        .send()
        .map_err(
            |_| GatewayError::ExecutionFailed
        )?;


    Ok(())

}










fn handle_client(
    mut stream:UnixStream,
    ledger:NonceLedger,
    signer:StdArc<GatewaySigner>,
){


    let mut buffer =
        Vec::new();



    if stream
        .read_to_end(
            &mut buffer
        )
        .is_err()
    {

        return;

    }



    if buffer.len()
        >
        MAX_REQUEST_BYTES
    {

        return;

    }






    let request:GatewayRequest =
        match serde_json::from_slice(
            &buffer
        ){

            Ok(v)=>v,

            Err(_)=>return,

        };








    /*
        Protocol validation
    */


    if request.protocol
        !=
        PROTOCOL_VERSION
    {

        return;

    }









    /*
        Replay protection
    */


    {

        // Consume the nonce through the verified tombstone ledger. `consume`
        // returns false on replay (nonce in the active ledger OR the spent
        // tombstone set) and on capacity pressure (fail-closed) — the exact
        // ConsumeNonce discipline of the TLA+ model. Transaction id is the
        // nonce (Tier-0 is 1:1); the commitment binds the nonce to c_i to
        // block nonce/commitment swaps.
        // Lock-free: the ledger is Arc<ReplayLedger> over a sharded DashSet;
        // consume() takes &self, so no external Mutex guard is needed. The
        // NoReplays discipline is unchanged — consume() still rejects a nonce in
        // the active ledger OR the spent tombstone set.
        let accepted =
            ledger.consume(
                request.nonce.clone(),
                request.nonce.clone(),
                request.c_i.clone(),
            );


        if !accepted {

            let receipt =
                GatewayReceipt{

                protocol:
                    PROTOCOL_VERSION.into(),

                status:
                    "REPLAY_REJECTED".into(),

                c_i:
                    request.c_i,

                c_e:
                    "NULL".into(),

                nonce:
                    request.nonce,

                timestamp:
                    now_timestamp(),

                policy_digest:
                    "NULL".into(),

                gateway_signature:
                    "".into(),

            };


            stream.write_all(
                &serde_json::to_vec(
                    &receipt
                ).unwrap()
            ).unwrap();


            return;

        }

    }








    /*
        Recover physical bytes.
    */


    let payload_bytes =
        match decode_payload(
            &request.payload
        ){

            Ok(v)=>v,

            Err(_)=>return,

        };







    /*
        Independent CE derivation.

        The gateway does NOT trust CI.
    */

    let c_e =
        sha256_bytes(
            &payload_bytes
        );








    /*
        CORE SECURITY PROPERTY

        Declared Action
              ==
        Observed Execution Bytes

    */

    if request.c_i
        !=
        c_e
    {


        let receipt =
            GatewayReceipt{


            protocol:
                PROTOCOL_VERSION.into(),


            status:
                "MUTATION_DETECTED_HALT".into(),


            c_i:
                request.c_i,


            c_e,


            nonce:
                request.nonce,


            timestamp:
                now_timestamp(),


            policy_digest:
                "NULL".into(),


            gateway_signature:
                "".into(),

        };



        stream.write_all(
            &serde_json::to_vec(
                &receipt
            ).unwrap()
        )
        .unwrap();



        return;

    }








    /*
        Only now may execution occur.
    */


    if execute_request(
        &request
    ).is_err()
    {

        return;

    }








    let timestamp =
        now_timestamp();



    let receipt =
        build_certified_receipt(
            &signer,
            request.c_i,
            c_e,
            request.nonce,
            timestamp,
        );





    stream.write_all(
        &serde_json::to_vec(
            &receipt
        ).unwrap()
    )
    .unwrap();

}









/*
    One-shot, hermetic receipt emission (no socket, no network execution).

    Exercises the SAME build_certified_receipt() signing path used by the
    socket handler, so recorded round-trip evidence reflects the shipped code.

    Usage:
      dab-gateway emit-receipt --payload-b64 <b64> --nonce <n>
                               [--timestamp <t>] [--mutate]
                               [--pubkey-out <path>]

    Prints the receipt JSON to stdout and the gateway public key (hex) to
    stderr (and to --pubkey-out when given). With --mutate, the declared
    commitment is deliberately set to differ from the derived execution
    commitment, producing a MUTATION_DETECTED_HALT receipt for negative tests.
*/
fn run_emit_receipt(
    args:&[String]
)->i32 {


    let mut payload_b64 =
        String::new();

    let mut nonce =
        "nonce-emit".to_string();

    let mut timestamp =
        "0".to_string();

    let mut mutate =
        false;

    let mut pubkey_out:Option<String> =
        None;


    let mut i = 0;

    while i < args.len() {

        match args[i].as_str() {

            "--payload-b64" => {
                i += 1;
                if i < args.len() { payload_b64 = args[i].clone(); }
            }

            "--nonce" => {
                i += 1;
                if i < args.len() { nonce = args[i].clone(); }
            }

            "--timestamp" => {
                i += 1;
                if i < args.len() { timestamp = args[i].clone(); }
            }

            "--pubkey-out" => {
                i += 1;
                if i < args.len() { pubkey_out = Some(args[i].clone()); }
            }

            "--mutate" => {
                mutate = true;
            }

            _ => {}

        }

        i += 1;

    }


    let signer =
        match GatewaySigner::from_dev_env() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("signer init failed: {e}");
                return 2;
            }
        };


    let payload_bytes =
        match decode_payload(&payload_b64) {
            Ok(v) => v,
            Err(_) => {
                eprintln!("invalid base64 payload");
                return 2;
            }
        };


    // Gateway independently derives C_E from the physical bytes.
    let c_e =
        sha256_bytes(&payload_bytes);


    // Honest declaration matches derivation; --mutate forges a divergence.
    let c_i =
        if mutate {
            sha256_bytes(b"__mutated_declaration__")
        } else {
            c_e.clone()
        };


    let pubkey_hex =
        signer.public_key_hex();

    if let Some(path) = &pubkey_out {
        let _ = std::fs::write(path, &pubkey_hex);
    }

    eprintln!("{pubkey_hex}");


    let receipt =
        if c_i != c_e {

            GatewayReceipt{
                protocol: PROTOCOL_VERSION.into(),
                status: "MUTATION_DETECTED_HALT".into(),
                c_i,
                c_e,
                nonce,
                timestamp,
                policy_digest: "NULL".into(),
                gateway_signature: "".into(),
            }

        } else {

            build_certified_receipt(
                &signer,
                c_i,
                c_e,
                nonce,
                timestamp,
            )

        };


    match serde_json::to_string_pretty(&receipt) {
        Ok(json) => {
            println!("{json}");
            0
        }
        Err(_) => {
            eprintln!("serialization failed");
            2
        }
    }

}




fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.len() > 1 && argv[1] == "emit-receipt" {
        std::process::exit(run_emit_receipt(&argv[2..]));
    }

    let _ = std::fs::remove_file(SOCKET_PATH);

    let listener = UnixListener::bind(SOCKET_PATH).expect("Cannot bind DAB socket");

    let signer = StdArc::new(
        GatewaySigner::from_dev_env().expect("gateway dev signer init failed"),
    );

    println!("DAB Gateway TCB online");
    let pubkey_hex = signer.public_key_hex();
    println!("gateway_public_key {pubkey_hex}");
    let _ = std::fs::write("/ipc/gateway.pub", &pubkey_hex);

    let ledger = nonce::create_nonce_ledger();

    // Spawn the Axum HTTP Gateway (Zero-Day 2, 5 Mitigation)
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            // Placeholder: axum HTTP router to replace Node.js server.ts
            let app = axum::Router::new().route(
                "/rpc/v1/agent-exec",
                axum::routing::post(handle_http_exec),
            );
            let listener = tokio::net::TcpListener::bind("0.0.0.0:30009").await.unwrap();
            println!("Rust Axum Proxy Gateway listening on 0.0.0.0:30009");
            axum::serve(listener, app).await.unwrap();
        });
    });

    for stream in listener.incoming().flatten() {
        {
            let ledger_clone = ledger.clone();
            let signer_clone = signer.clone();

            std::thread::spawn(move || {
                handle_client(stream, ledger_clone, signer_clone);
            });
        }
    }
}

// Minimal Axum HTTP handler replacing Node.js event-loop
async fn handle_http_exec(
    axum::Json(_payload): axum::Json<serde_json::Value>,
) -> axum::response::Json<serde_json::Value> {
    // Structural representation of agent exec without V8 pollution
    axum::response::Json(serde_json::json!({
        "verdict": "ABORT_TEMPORAL_DRIFT",
        "ledgerChanged": false,
        "receipt": "0000000000000000000000000000000000000000000000000000000000000000"
    }))
}