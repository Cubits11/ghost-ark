//! Ghost-Ark DAB Tier-0
//!
//! Declarative Action Binding
//!
//! Trusted Gateway Internal Verification Module
//!
//! Responsibilities:
//!
//! 1. Validate incoming execution envelope.
//! 2. Verify C_I / C_E binding.
//! 3. Verify protocol invariants.
//! 4. Verify transaction uniqueness assumptions.
//! 5. Prepare receipt certification decision.
//!
//!
//! IMPORTANT:
//!
//! This verifier is INSIDE the Trusted Computing Base.
//!
//! It protects against:
//!
//! - malformed requests
//! - accidental implementation mistakes
//! - invalid state transitions
//!
//!
//! It does NOT replace:
//!
//! dab-verifier/
//!
//! which provides independent verification.



use crate::receipts::{
    DABReceipt,
    ReceiptStatus,
};





/// Verification failures.
#[derive(Debug)]
pub enum VerificationError {


    MissingField(String),


    ProtocolMismatch,


    CommitmentMismatch,


    InvalidStatus,


    MissingSignature,


    InvalidTransactionBinding,

}





/// Gateway execution context.
///
/// This is the minimum information
/// required to certify execution.
#[derive(Debug)]
pub struct ExecutionContext {


    /// Declaration commitment.
    pub c_i:
        String,


    /// Observed execution commitment.
    pub c_e:
        String,


    /// Replay nonce.
    pub nonce:
        String,


    /// Transaction identifier.
    pub transaction_id:
        String,


    /// Gateway policy digest.
    pub policy_digest:
        String,


}









/// Validate a request BEFORE execution.
///
/// This is the first security gate.
pub fn validate_execution_context(
    ctx:&ExecutionContext
)
-> Result<(),VerificationError>{



    if ctx.c_i.is_empty(){

        return Err(
            VerificationError::MissingField(
                "c_i".into()
            )
        );

    }




    if ctx.c_e.is_empty(){

        return Err(
            VerificationError::MissingField(
                "c_e".into()
            )
        );

    }




    if ctx.nonce.is_empty(){

        return Err(
            VerificationError::MissingField(
                "nonce".into()
            )
        );

    }




    if ctx.transaction_id.is_empty(){

        return Err(
            VerificationError::MissingField(
                "transaction_id".into()
            )
        );

    }




    if ctx.policy_digest.is_empty(){

        return Err(
            VerificationError::MissingField(
                "policy_digest".into()
            )
        );

    }




    Ok(())

}









/// Core DAB invariant.
///
/// Security theorem condition:
///
///        C_I == C_E
///
/// means:
///
/// declared artifact bytes
///
/// equal
///
/// observed execution bytes
///
pub fn verify_execution_binding(
    c_i:&str,
    c_e:&str
)
-> Result<(),VerificationError>{



    if c_i != c_e {


        return Err(
            VerificationError::CommitmentMismatch
        );

    }



    Ok(())

}









/// Validate receipt before release.
///
/// A gateway must never emit:
///
/// CERTIFIED
///
/// without satisfying all invariants.
pub fn validate_receipt(
    receipt:&DABReceipt
)
-> Result<(),VerificationError>{



    /*
        Protocol validation
    */
    if receipt.protocol
        !=
        crate::receipts::RECEIPT_PROTOCOL_VERSION
    {

        return Err(
            VerificationError::ProtocolMismatch
        );

    }






    /*
        Only certified receipts
        require execution binding.
    */
    if receipt.status
        ==
        ReceiptStatus::CERTIFIED
    {


        verify_execution_binding(
            &receipt.c_i,
            &receipt.c_e
        )?;



        if receipt.signature.is_empty(){

            return Err(
                VerificationError::MissingSignature
            );

        }

    }





    if receipt.transaction_id.is_empty(){

        return Err(
            VerificationError::InvalidTransactionBinding
        );

    }




    Ok(())

}









/// Final certification decision.
///
/// This is the function
/// main.rs should call before:
///
/// network execution
///
pub fn can_execute(
    ctx:&ExecutionContext
)
-> bool {



    validate_execution_context(
        ctx
    )
    .is_ok()

}









/// Final receipt decision.
///
/// Called after execution.
pub fn can_certify(
    receipt:&DABReceipt
)
-> bool {


    validate_receipt(
        receipt
    )
    .is_ok()

}









#[cfg(test)]
mod tests {


    use super::*;



    #[test]
    fn identical_commitments_pass(){


        let result =
            verify_execution_binding(
                "abc",
                "abc"
            );


        assert!(
            result.is_ok()
        );


    }







    #[test]
    fn mutated_commitments_fail(){


        let result =
            verify_execution_binding(
                "abc",
                "xyz"
            );


        assert!(
            result.is_err()
        );

    }

}