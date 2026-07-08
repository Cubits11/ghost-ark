import {
  ReceiptProof,
  ReceiptProofClaims,
  ReceiptProofPublicInputs,
  localReceiptProofTranscriptDigest,
  receiptProofStatementDigest,
  validateReceiptProof
} from "./receiptProof";

export function createLocalReceiptProof(input: {
  publicInputs: ReceiptProofPublicInputs;
  claims: ReceiptProofClaims;
  transcriptWitnessDigest: string;
}): ReceiptProof {
  const statement = {
    schemaVersion: "ghost.receipt_proof_statement.v1" as const,
    proofSystem: "local-transcript" as const,
    statementDigest: receiptProofStatementDigest({
      proofSystem: "local-transcript",
      publicInputs: input.publicInputs,
      claims: input.claims
    }),
    publicInputs: input.publicInputs,
    claims: input.claims
  };

  return validateReceiptProof({
    schemaVersion: "ghost.receipt_proof.v1",
    proofSystem: "local-transcript",
    statement,
    proof: {
      transcriptDigest: localReceiptProofTranscriptDigest({
        publicInputs: input.publicInputs,
        claims: input.claims,
        transcriptWitnessDigest: input.transcriptWitnessDigest
      }),
      backendMetadata: {
        backend: "local-transcript-dev-only",
        devOnly: true,
        notZeroKnowledge: true,
        transcriptWitnessDigest: input.transcriptWitnessDigest
      }
    }
  });
}
