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
    collections::HashSet,
    io::{Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    sync::{Arc, Mutex},
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




const SOCKET_PATH:&str =
    "/ipc/dab.sock";


const MAX_REQUEST_BYTES:usize =
    1024 * 1024;



const PROTOCOL_VERSION:&str =
    "DAB-TIER0-V1";





/*
    Replay protection ledger.

    Production:
        Redis/KMS/TEE-backed storage.

    Tier-0:
        in-memory bounded ledger.
*/
type NonceLedger =
    Arc<Mutex<HashSet<String>>>;







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


    gateway_signature:String,

}









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
    Placeholder.

    Replace with:

    AWS KMS
    Nitro Enclave key
    TPM key
    HSM

*/
fn sign_receipt(
    message:&str
)->String {


    format!(
        "DEV_SIGNATURE:{}",
        sha256_bytes(
            message.as_bytes()
        )
    )

}









fn decode_payload(
    encoded:&str
)->Result<Vec<u8>,GatewayError>{


    base64::decode(encoded)
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
    ledger:NonceLedger
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

        let mut used =
            ledger.lock()
            .unwrap();


        if used.contains(
            &request.nonce
        ){

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


        used.insert(
            request.nonce.clone()
        );

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


            c_e:
                c_e,


            nonce:
                request.nonce,


            timestamp:
                now_timestamp(),


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




    let signing_material =
        format!(
            "{}|{}|{}|{}",
            request.c_i,
            c_e,
            request.nonce,
            timestamp
        );



    let signature =
        sign_receipt(
            &signing_material
        );







    let receipt =
        GatewayReceipt{


        protocol:
            PROTOCOL_VERSION.into(),


        status:
            "CERTIFIED".into(),


        c_i:
            request.c_i,


        c_e,


        nonce:
            request.nonce,


        timestamp,


        gateway_signature:
            signature,

    };





    stream.write_all(
        &serde_json::to_vec(
            &receipt
        ).unwrap()
    )
    .unwrap();

}









fn main(){


    let _ =
        std::fs::remove_file(
            SOCKET_PATH
        );



    let listener =
        UnixListener::bind(
            SOCKET_PATH
        )
        .expect(
            "Cannot bind DAB socket"
        );



    println!(
        "DAB Gateway TCB online"
    );



    let ledger =
        Arc::new(
            Mutex::new(
                HashSet::new()
            )
        );




    for stream in listener.incoming(){


        if let Ok(stream)=stream{


            let ledger_clone =
                ledger.clone();


            std::thread::spawn(
                move || {

                    handle_client(
                        stream,
                        ledger_clone
                    );

                }
            );


        }

    }

}