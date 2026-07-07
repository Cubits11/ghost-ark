import { canonicalUnsignedDecisionReceipt, decisionReceiptDigest, receiptIdFromUnsignedDecisionReceipt, unsignedReceiptForSigning } from "./canonical";
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

export interface ParsedDecisionReceiptSignatureEnvelope {
  keyId?: unknown;
  digestSha256?: unknown;
  signature?: unknown;
}

export interface DecisionReceiptCanonicalVerifier {
  readonly algorithm: SignedDecisionReceipt["signature_alg"];
  readonly keyId?: string;
  verifyCanonical(
    canonicalPayload: string,
    signature: string,
    receipt: SignedDecisionReceipt,
    envelope: ParsedDecisionReceiptSignatureEnvelope
  ): boolean | Promise<boolean>;
}

function check(name: string, passed: boolean, detail: string): DecisionReceiptVerificationCheck {
  return { name, passed, detail };
}

export function parseDecisionReceiptSignatureEnvelope(signatureEnvelope: string): ParsedDecisionReceiptSignatureEnvelope {
  try {
    return JSON.parse(Buffer.from(signatureEnvelope, "base64url").toString("utf8")) as ParsedDecisionReceiptSignatureEnvelope;
  } catch {
    return {};
  }
}

export async function verifyDecisionReceipt(
  value: unknown,
  verifier: DecisionReceiptCanonicalVerifier
): Promise<DecisionReceiptVerificationResult> {
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
      receipt.signature_alg === verifier.algorithm,
      receipt.signature_alg === verifier.algorithm
        ? `Signature algorithm ${receipt.signature_alg} is expected.`
        : `Unexpected signature algorithm ${receipt.signature_alg}.`
    )
  );

  const canonicalPayload = canonicalUnsignedDecisionReceipt(receipt);
  const signatureEnvelope = parseDecisionReceiptSignatureEnvelope(receipt.receipt_signature);
  const embeddedKeyId = typeof signatureEnvelope.keyId === "string" ? signatureEnvelope.keyId : "";
  const embeddedDigest = typeof signatureEnvelope.digestSha256 === "string" ? signatureEnvelope.digestSha256 : "";
  const embeddedSignature = typeof signatureEnvelope.signature === "string" ? signatureEnvelope.signature : "";
  const expectedKeyId = verifier.keyId;

  checks.push(
    check(
      "key_id",
      Boolean(embeddedKeyId) && (!expectedKeyId || embeddedKeyId === expectedKeyId),
      !embeddedKeyId
        ? "Signature envelope does not contain a keyId."
        : expectedKeyId && embeddedKeyId !== expectedKeyId
          ? `Signature keyId mismatch. Expected ${expectedKeyId}; observed ${embeddedKeyId}.`
          : `Signature keyId ${embeddedKeyId} is present.`
    )
  );

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

  checks.push(
    check(
      "canonical_payload",
      canonicalPayload.length > 0,
      canonicalPayload.length > 0
        ? "Canonical unsigned decision receipt payload was recomputed."
        : "Canonical unsigned decision receipt payload was empty."
    )
  );

  if (!embeddedSignature) {
    checks.push(check("signature", false, "Signature envelope does not contain a signature."));
  } else if (receipt.signature_alg !== verifier.algorithm) {
    checks.push(check("signature", false, "Signature verification skipped because algorithm check failed."));
  } else {
    let signaturePassed = false;
    let detail = "Signature verification over canonical unsigned envelope completed.";
    try {
      signaturePassed = await verifier.verifyCanonical(canonicalPayload, embeddedSignature, receipt, signatureEnvelope);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    checks.push(
      check(
        "signature",
        signaturePassed,
        detail
      )
    );
  }

  return {
    verdict: checks.every((entry) => entry.passed),
    checks
  };
}
