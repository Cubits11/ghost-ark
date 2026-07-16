// Airy DAB doc style (blank lines after doc comments) is a formatting choice;
// its stylistic clippy lint is allowed. Correctness lints remain enforced.
#![allow(clippy::empty_line_after_doc_comments)]

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








// Domain-hash helper retained for evidence/transparency tooling and exercised
// by the stability test below; not on the hot verification path.
#[allow(dead_code)]
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



    // ---- Round-trip contract tests -------------------------------------
    //
    // These construct a correctly-signed receipt with a fixed dev key and
    // assert the verifier accepts it, then assert that each tampered variant
    // is rejected with the specific error. This is the independent-crate
    // evidence that the verifier's message construction and signature check
    // are internally consistent; the shell harness additionally proves the
    // *gateway binary* produces receipts that pass this same verifier.

    use ed25519_dalek::{Signer, SigningKey};

    const TEST_SEED: [u8; 32] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1,
    ];

    fn signed_receipt_json(
        c_i: &str,
        c_e: &str,
        nonce: &str,
        timestamp: &str,
        policy_digest: &str,
    ) -> (String, Vec<u8>) {
        let key = SigningKey::from_bytes(&TEST_SEED);
        let message = format!(
            "{}{}|{}|{}|{}|{}|{}",
            SIGNATURE_DOMAIN, PROTOCOL_VERSION, c_i, c_e, nonce, timestamp, policy_digest
        );
        let signature = key.sign(message.as_bytes());
        let sig_hex = hex::encode(signature.to_bytes());
        let pubkey = key.verifying_key().to_bytes().to_vec();
        let json = format!(
            r#"{{"protocol":"{PROTOCOL_VERSION}","status":"CERTIFIED","c_i":"{c_i}","c_e":"{c_e}","nonce":"{nonce}","timestamp":"{timestamp}","policy_digest":"{policy_digest}","gateway_signature":"{sig_hex}"}}"#
        );
        (json, pubkey)
    }

    #[test]
    fn certified_receipt_verifies() {
        let (json, pk) =
            signed_receipt_json("cAFE", "cAFE", "n-1", "0", "sha256:policy");
        assert!(matches!(verify_dab_receipt(&json, &pk), Ok(true)));
    }

    #[test]
    fn commitment_mismatch_is_rejected() {
        // c_i != c_e: the DAB theorem fails before the signature is even trusted.
        let (json, pk) =
            signed_receipt_json("cAFE", "dEAD", "n-1", "0", "sha256:policy");
        assert!(matches!(
            verify_dab_receipt(&json, &pk),
            Err(VerificationError::CommitmentMismatch)
        ));
    }

    #[test]
    fn tampered_field_breaks_signature() {
        // Sign one policy_digest, present another: the signed message no longer
        // matches, so ed25519 verification fails.
        let (json, pk) =
            signed_receipt_json("cAFE", "cAFE", "n-1", "0", "sha256:policy");
        let tampered = json.replace("sha256:policy", "sha256:ATTACKER");
        assert!(matches!(
            verify_dab_receipt(&tampered, &pk),
            Err(VerificationError::InvalidSignature)
        ));
    }

    #[test]
    fn wrong_public_key_is_rejected() {
        let (json, _pk) =
            signed_receipt_json("cAFE", "cAFE", "n-1", "0", "sha256:policy");
        let mut wrong = SigningKey::from_bytes(&[7u8; 32]).verifying_key().to_bytes().to_vec();
        // Ensure it differs from the real key.
        wrong[0] ^= 0xFF;
        assert!(matches!(
            verify_dab_receipt(&json, &wrong),
            Err(VerificationError::InvalidSignature)
        ));
    }

    #[test]
    fn non_certified_status_is_rejected() {
        let (json, pk) =
            signed_receipt_json("cAFE", "cAFE", "n-1", "0", "sha256:policy");
        let halted = json.replace("CERTIFIED", "MUTATION_DETECTED_HALT");
        assert!(matches!(
            verify_dab_receipt(&halted, &pk),
            Err(VerificationError::InvalidStatus)
        ));
    }

}