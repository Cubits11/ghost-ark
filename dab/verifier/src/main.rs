/**
 * Ghost-Ark DAB Tier-0
 *
 * Independent Receipt Verifier
 *
 * Security property:
 *
 * The verifier does NOT trust:
 *
 * - agent runtime
 * - gateway implementation
 * - execution process
 *
 * It only trusts:
 *
 * - cryptographic signature
 * - deterministic evidence
 *
 */


use serde::Deserialize;

use ed25519_dalek::{
    Signature,
    Verifier,
    VerifyingKey,
};

use sha2::{
    Sha256,
    Digest,
};




const PROTOCOL_VERSION:
    &str =
    "DAB-TIER0-V1";



const SIGNATURE_DOMAIN:
    &str =
    "GHOST-ARK:DAB:RECEIPT:";







#[derive(Debug,Deserialize)]
struct DABReceipt {


    protocol:String,


    status:String,


    c_i:String,


    c_e:String,


    nonce:String,


    timestamp:String,


    policy_digest:String,


    gateway_signature:String,

}






#[derive(Debug)]
pub enum VerificationError {


    MalformedReceipt,


    ProtocolMismatch,


    InvalidStatus,


    CommitmentMismatch,


    InvalidSignature,


    InvalidPublicKey,


}








fn hash(
    input:&str
)->String{


    let mut hasher =
        Sha256::new();


    hasher.update(
        input.as_bytes()
    );


    format!(
        "sha256:{:x}",
        hasher.finalize()
    )

}









pub fn verify_dab_receipt(
    receipt_json:&str,
    public_key_bytes:&[u8]
)
->Result<bool,VerificationError>{


    /*
        Strict parsing.

        No Value access.
        No unwrap.
    */

    let receipt:DABReceipt =
        serde_json::from_str(
            receipt_json
        )
        .map_err(
            |_| VerificationError::MalformedReceipt
        )?;








    /*
        Protocol binding
    */

    if receipt.protocol
        !=
        PROTOCOL_VERSION
    {

        return Err(
            VerificationError::ProtocolMismatch
        );

    }







    /*
        Only successful executions
        are verifiable.
    */

    if receipt.status
        !=
        "CERTIFIED"
    {

        return Err(
            VerificationError::InvalidStatus
        );

    }








    /*
        Core DAB theorem:

        Declared Action
              ==
        Observed Execution
    */

    if receipt.c_i
        !=
        receipt.c_e
    {

        return Err(
            VerificationError::CommitmentMismatch
        );

    }








    /*
        Verify gateway identity
    */


    let key =
        VerifyingKey::from_bytes(
            public_key_bytes
            .try_into()
            .map_err(
                |_| VerificationError::InvalidPublicKey
            )?
        )
        .map_err(
            |_| VerificationError::InvalidPublicKey
        )?;








    let message =
        format!(
            "{}{}|{}|{}|{}|{}|{}",
            SIGNATURE_DOMAIN,
            receipt.protocol,
            receipt.c_i,
            receipt.c_e,
            receipt.nonce,
            receipt.timestamp,
            receipt.policy_digest
        );








    let signature_bytes =
        hex::decode(
            receipt.gateway_signature
        )
        .map_err(
            |_| VerificationError::InvalidSignature
        )?;





    let signature =
        Signature::from_slice(
            &signature_bytes
        )
        .map_err(
            |_| VerificationError::InvalidSignature
        )?;








    key.verify(
        message.as_bytes(),
        &signature
    )
    .map_err(
        |_| VerificationError::InvalidSignature
    )?;






    Ok(true)

}








#[cfg(test)]
mod tests {


    use super::*;



    #[test]
    fn domain_hash_is_stable(){


        let a =
            hash(
                "hello"
            );


        let b =
            hash(
                "hello"
            );


        assert_eq!(
            a,
            b
        );

    }

}