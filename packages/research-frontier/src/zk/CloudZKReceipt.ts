export interface ZKReceiptStatement {
  receiptId: string;
  publicDigest: string;
  proofBytesBase64: string;
}

/**
 * Non-cryptographic, simulation-only mock verifier interface for ZK receipt research frontier.
 * This class does NOT execute zero-knowledge circuit validation.
 */
export class MockCloudZKReceiptVerifier {
  verifyProof(statement: ZKReceiptStatement): boolean {
    return (
      Boolean(statement.receiptId) &&
      Boolean(statement.publicDigest) &&
      Boolean(statement.proofBytesBase64)
    );
  }
}
