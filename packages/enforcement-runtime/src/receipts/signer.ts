import { createHmac, timingSafeEqual } from "crypto";
import { canonicalUnsignedDecisionReceipt, decisionReceiptDigest } from "./canonical";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export interface DecisionReceiptSigner {
  readonly keyId: string;
  readonly algorithm: SignedDecisionReceipt["signature_alg"];
  signCanonical(canonicalPayload: string): string;
  verifyCanonical?(canonicalPayload: string, signature: string): boolean;
}

export class LocalDevHmacReceiptSigner implements DecisionReceiptSigner {
  readonly algorithm = "LOCAL_HMAC_SHA256_DEV_ONLY" as const;
  readonly keyId: string;
  private readonly secret: string;

  constructor(options: { keyId?: string; secret: string }) {
    this.keyId = options.keyId ?? "local-dev-hmac";
    this.secret = options.secret;
  }

  signCanonical(canonicalPayload: string): string {
    return createHmac("sha256", this.secret).update(canonicalPayload).digest("base64");
  }

  verifyCanonical(canonicalPayload: string, signature: string): boolean {
    const expected = Buffer.from(this.signCanonical(canonicalPayload), "base64");
    const observed = Buffer.from(signature, "base64");
    return expected.length === observed.length && timingSafeEqual(expected, observed);
  }
}

export function signDecisionReceipt(receipt: UnsignedDecisionReceipt, signer: DecisionReceiptSigner): SignedDecisionReceipt {
  if (receipt.signature_alg !== signer.algorithm) {
    throw new Error(`Receipt signature_alg ${receipt.signature_alg} does not match signer algorithm ${signer.algorithm}`);
  }
  const canonicalPayload = canonicalUnsignedDecisionReceipt(receipt);
  const signatureEnvelope = {
    keyId: signer.keyId,
    digestSha256: decisionReceiptDigest(receipt),
    signature: signer.signCanonical(canonicalPayload)
  };
  const signed = {
    ...receipt,
    receipt_signature: Buffer.from(JSON.stringify(signatureEnvelope), "utf8").toString("base64url")
  };
  return validateSignedDecisionReceipt(signed);
}
