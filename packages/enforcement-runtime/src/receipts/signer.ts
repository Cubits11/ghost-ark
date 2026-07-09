import { createHmac, timingSafeEqual } from "crypto";
import {
  assertNonDefaultExecutionBoundary,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest
} from "./canonical";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";
import { canonicalize } from "../../../receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../shared/src/errors";

export interface DecisionReceiptSigner {
  readonly keyId: string;
  readonly algorithm: SignedDecisionReceipt["signature_alg"];
  signCanonical(canonicalPayload: string): string;
  verifyCanonical?(canonicalPayload: string, signature: string): boolean;
}

export interface DecisionReceiptSignatureEnvelope {
  readonly schemaVersion: "ghost.decision_receipt_signature.v1";
  readonly keyId: string;
  readonly algorithm: SignedDecisionReceipt["signature_alg"];
  readonly digestSha256: string;
  readonly signature: string;
}

function signingError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.decision_receipt_signer.v1", ...context });
}

function assertNonEmptyString(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw signingError(`${name} must be a non-empty string.`, { field: name });
  }
}

function assertBase64Signature(signature: string): void {
  assertNonEmptyString("signature", signature);

  try {
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length === 0) {
      throw signingError("signature must decode to non-empty bytes.", { field: "signature" });
    }
  } catch (error) {
    throw signingError("signature must be valid base64.", {
      field: "signature",
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export function encodeDecisionReceiptSignatureEnvelope(envelope: DecisionReceiptSignatureEnvelope): string {
  return Buffer.from(canonicalize(envelope), "utf8").toString("base64url");
}

export function decodeDecisionReceiptSignatureEnvelope(value: string): DecisionReceiptSignatureEnvelope {
  assertNonEmptyString("receipt_signature", value);

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    throw signingError("receipt_signature must be a base64url-encoded JSON signature envelope.", {
      field: "receipt_signature",
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw signingError("receipt_signature envelope must decode to an object.", { field: "receipt_signature" });
  }

  const envelope = parsed as Record<string, unknown>;
  if (envelope.schemaVersion !== "ghost.decision_receipt_signature.v1") {
    throw signingError("receipt_signature envelope has an unsupported schemaVersion.", {
      field: "schemaVersion",
      observed: envelope.schemaVersion
    });
  }

  if (envelope.algorithm !== "LOCAL_HMAC_SHA256_DEV_ONLY" && envelope.algorithm !== "KMS_SIGN_RSASSA_PSS_SHA_256") {
    throw signingError("receipt_signature envelope has an unsupported algorithm.", {
      field: "algorithm",
      observed: envelope.algorithm
    });
  }

  if (typeof envelope.keyId !== "string" || envelope.keyId.length === 0) {
    throw signingError("receipt_signature envelope keyId must be non-empty.", { field: "keyId" });
  }

  if (typeof envelope.digestSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(envelope.digestSha256)) {
    throw signingError("receipt_signature envelope digestSha256 must be a lowercase SHA-256 hex digest.", {
      field: "digestSha256"
    });
  }

  if (typeof envelope.signature !== "string" || envelope.signature.length === 0) {
    throw signingError("receipt_signature envelope signature must be non-empty.", { field: "signature" });
  }

  return {
    schemaVersion: "ghost.decision_receipt_signature.v1",
    keyId: envelope.keyId,
    algorithm: envelope.algorithm,
    digestSha256: envelope.digestSha256,
    signature: envelope.signature
  };
}

export class LocalDevHmacReceiptSigner implements DecisionReceiptSigner {
  readonly algorithm = "LOCAL_HMAC_SHA256_DEV_ONLY" as const;
  readonly keyId: string;
  private readonly secret: string;

  constructor(options: { keyId?: string; secret: string }) {
    assertNonEmptyString("secret", options.secret);

    this.keyId = options.keyId ?? "local-dev-hmac";
    this.secret = options.secret;
  }

  signCanonical(canonicalPayload: string): string {
    assertNonEmptyString("canonicalPayload", canonicalPayload);
    return createHmac("sha256", this.secret).update(canonicalPayload).digest("base64");
  }

  verifyCanonical(canonicalPayload: string, signature: string): boolean {
    assertNonEmptyString("canonicalPayload", canonicalPayload);
    assertBase64Signature(signature);

    const expected = Buffer.from(this.signCanonical(canonicalPayload), "base64");
    const observed = Buffer.from(signature, "base64");

    return expected.length === observed.length && timingSafeEqual(expected, observed);
  }
}

export function signDecisionReceipt(receipt: UnsignedDecisionReceipt, signer: DecisionReceiptSigner): SignedDecisionReceipt {
  if (receipt.signature_alg !== signer.algorithm) {
    throw signingError(`Receipt signature_alg ${receipt.signature_alg} does not match signer algorithm ${signer.algorithm}`, {
      receiptAlgorithm: receipt.signature_alg,
      signerAlgorithm: signer.algorithm
    });
  }

  if (signer.algorithm === "KMS_SIGN_RSASSA_PSS_SHA_256") {
    assertNonDefaultExecutionBoundary(receipt);
  }

  const canonicalPayload = canonicalUnsignedDecisionReceipt(receipt);
  const digestSha256 = decisionReceiptDigest(receipt);
  const signature = signer.signCanonical(canonicalPayload);
  assertBase64Signature(signature);

  const signatureEnvelope: DecisionReceiptSignatureEnvelope = {
    schemaVersion: "ghost.decision_receipt_signature.v1",
    keyId: signer.keyId,
    algorithm: signer.algorithm,
    digestSha256,
    signature
  };

  const signed = {
    ...receipt,
    receipt_signature: encodeDecisionReceiptSignatureEnvelope(signatureEnvelope)
  };

  return validateSignedDecisionReceipt(signed);
}