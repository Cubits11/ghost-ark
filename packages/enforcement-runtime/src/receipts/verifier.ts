import { canonicalUnsignedDecisionReceipt, decisionReceiptDigest, receiptIdFromUnsignedDecisionReceipt, unsignedReceiptForSigning } from "./canonical";
import { DecisionReceiptSigner } from "./signer";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export interface DecisionReceiptVerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DecisionReceiptVerificationResult {
  verdict: boolean;
  checks: DecisionReceiptVerificationCheck[];
}

interface ParsedSignatureEnvelope {
  keyId?: unknown;
  digestSha256?: unknown;
  signature?: unknown;
}

function check(name: string, passed: boolean, detail: string): DecisionReceiptVerificationCheck {
  return { name, passed, detail };
}

function parseSignatureEnvelope(signatureEnvelope: string): ParsedSignatureEnvelope {
  try {
    return JSON.parse(Buffer.from(signatureEnvelope, "base64url").toString("utf8")) as ParsedSignatureEnvelope;
  } catch {
    return {};
  }
}

export function verifyDecisionReceipt(
  value: unknown,
  signer: Pick<DecisionReceiptSigner, "algorithm" | "verifyCanonical">
): DecisionReceiptVerificationResult {
  const checks: DecisionReceiptVerificationCheck[] = [];
  let receipt: SignedDecisionReceipt;

  try {
    receipt = validateSignedDecisionReceipt(value);
    checks.push(check("schema", true, "Decision receipt matches ghost.receipt.v1 schema."));
  } catch (error) {
    checks.push(check("schema", false, error instanceof Error ? error.message : String(error)));
    return { verdict: false, checks };
  }

  const unsigned = unsignedReceiptForSigning(receipt);
  const { receipt_id: _receiptId, ...withoutId } = unsigned;
  const expectedReceiptId = receiptIdFromUnsignedDecisionReceipt(withoutId);
  checks.push(
    check(
      "receipt_id",
      expectedReceiptId === receipt.receipt_id,
      expectedReceiptId === receipt.receipt_id
        ? "Receipt id matches canonical unsigned envelope."
        : `Receipt id mismatch. Expected ${expectedReceiptId}; observed ${receipt.receipt_id}.`
    )
  );

  checks.push(
    check(
      "algorithm",
      receipt.signature_alg === signer.algorithm,
      receipt.signature_alg === signer.algorithm
        ? `Signature algorithm ${receipt.signature_alg} is expected.`
        : `Unexpected signature algorithm ${receipt.signature_alg}.`
    )
  );

  const signatureEnvelope = parseSignatureEnvelope(receipt.receipt_signature);
  const embeddedDigest = typeof signatureEnvelope.digestSha256 === "string" ? signatureEnvelope.digestSha256 : "";
  const recomputedDigest = decisionReceiptDigest(receipt);
  checks.push(
    check(
      "digest",
      embeddedDigest === recomputedDigest,
      embeddedDigest === recomputedDigest
        ? "Embedded signature digest matches canonical unsigned envelope digest."
        : `Digest mismatch. Expected ${recomputedDigest}; observed ${embeddedDigest}.`
    )
  );

  if (!signer.verifyCanonical) {
    checks.push(check("signature", false, "Signer does not expose local verification."));
  } else {
    const signature = typeof signatureEnvelope.signature === "string" ? signatureEnvelope.signature : "";
    checks.push(
      check(
        "signature",
        signer.verifyCanonical(canonicalUnsignedDecisionReceipt(receipt), signature),
        "Signature verification over canonical unsigned envelope completed."
      )
    );
  }

  return {
    verdict: checks.every((entry) => entry.passed),
    checks
  };
}
