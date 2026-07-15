import { createHmac, timingSafeEqual } from "crypto";
import {
  assertNonDefaultExecutionBoundary,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest
} from "./canonical";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt, validateUnsignedDecisionReceipt } from "./schema";
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

const signatureEnvelopeSchemaVersion = "ghost.decision_receipt_signature.v1" as const;
const localDevHmacAlgorithm = "LOCAL_HMAC_SHA256_DEV_ONLY" as const;
const kmsRsaPssAlgorithm = "KMS_SIGN_RSASSA_PSS_SHA_256" as const;

const lowerSha256HexPattern = /^[a-f0-9]{64}$/u;
const standardBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const base64urlJsonPattern = /^[A-Za-z0-9_-]+$/u;

function signingError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.decision_receipt_signer.v1", ...context });
}

function assertNonEmptyString(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw signingError(`${name} must be a non-empty string.`, { field: name });
  }
}

function assertKnownSignatureAlgorithm(algorithm: unknown): asserts algorithm is SignedDecisionReceipt["signature_alg"] {
  if (algorithm !== localDevHmacAlgorithm && algorithm !== kmsRsaPssAlgorithm) {
    throw signingError("Unsupported decision receipt signature algorithm.", {
      field: "algorithm",
      observed: algorithm
    });
  }
}

function assertSignerShape(signer: DecisionReceiptSigner): void {
  if (!signer || typeof signer !== "object") {
    throw signingError("Decision receipt signer must be an object.", { field: "signer" });
  }

  assertNonEmptyString("keyId", signer.keyId);
  assertKnownSignatureAlgorithm(signer.algorithm);

  if (typeof signer.signCanonical !== "function") {
    throw signingError("Decision receipt signer must expose signCanonical().", { field: "signCanonical" });
  }
}

function assertLowerSha256Hex(name: string, value: string): void {
  if (!lowerSha256HexPattern.test(value)) {
    throw signingError(`${name} must be a lowercase SHA-256 hex digest.`, { field: name });
  }
}

function assertStandardBase64Signature(signature: string): void {
  assertNonEmptyString("signature", signature);

  if (!standardBase64Pattern.test(signature)) {
    throw signingError("signature must be standard base64-encoded bytes.", { field: "signature" });
  }

  const decoded = Buffer.from(signature, "base64");
  if (decoded.length === 0) {
    throw signingError("signature must decode to non-empty bytes.", { field: "signature" });
  }
}

function assertBase64urlEnvelope(value: string): void {
  assertNonEmptyString("receipt_signature", value);

  if (!base64urlJsonPattern.test(value)) {
    throw signingError("receipt_signature must be unpadded base64url text.", {
      field: "receipt_signature"
    });
  }
}

function assertExactEnvelopeKeys(envelope: Record<string, unknown>): void {
  const expected = ["algorithm", "digestSha256", "keyId", "schemaVersion", "signature"].sort();
  const observed = Object.keys(envelope).sort();

  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) {
    throw signingError("receipt_signature envelope contains an unexpected field set.", {
      field: "receipt_signature",
      expected,
      observed
    });
  }
}

function assertEnvelopeShape(envelope: Record<string, unknown>): DecisionReceiptSignatureEnvelope {
  assertExactEnvelopeKeys(envelope);

  if (envelope.schemaVersion !== signatureEnvelopeSchemaVersion) {
    throw signingError("receipt_signature envelope has an unsupported schemaVersion.", {
      field: "schemaVersion",
      observed: envelope.schemaVersion
    });
  }

  assertKnownSignatureAlgorithm(envelope.algorithm);

  if (typeof envelope.keyId !== "string" || envelope.keyId.length === 0) {
    throw signingError("receipt_signature envelope keyId must be non-empty.", { field: "keyId" });
  }

  if (typeof envelope.digestSha256 !== "string") {
    throw signingError("receipt_signature envelope digestSha256 must be a string.", {
      field: "digestSha256"
    });
  }

  assertLowerSha256Hex("digestSha256", envelope.digestSha256);

  if (typeof envelope.signature !== "string") {
    throw signingError("receipt_signature envelope signature must be a string.", { field: "signature" });
  }

  assertStandardBase64Signature(envelope.signature);

  return {
    schemaVersion: signatureEnvelopeSchemaVersion,
    keyId: envelope.keyId,
    algorithm: envelope.algorithm,
    digestSha256: envelope.digestSha256,
    signature: envelope.signature
  };
}

export function encodeDecisionReceiptSignatureEnvelope(envelope: DecisionReceiptSignatureEnvelope): string {
  assertEnvelopeShape({ ...envelope });
  return Buffer.from(canonicalize(envelope), "utf8").toString("base64url");
}

export function decodeDecisionReceiptSignatureEnvelope(value: string): DecisionReceiptSignatureEnvelope {
  assertBase64urlEnvelope(value);

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
    throw signingError("receipt_signature envelope must decode to an object.", {
      field: "receipt_signature"
    });
  }

  return assertEnvelopeShape(parsed as Record<string, unknown>);
}

export class LocalDevHmacReceiptSigner implements DecisionReceiptSigner {
  readonly algorithm = localDevHmacAlgorithm;
  readonly keyId: string;
  private readonly secret: string;

  constructor(options: { keyId?: string; secret: string }) {
    assertNonEmptyString("secret", options.secret);

    this.keyId = options.keyId ?? "local-dev-hmac";
    assertNonEmptyString("keyId", this.keyId);

    this.secret = options.secret;
  }

  signCanonical(canonicalPayload: string): string {
    assertNonEmptyString("canonicalPayload", canonicalPayload);
    return createHmac("sha256", this.secret).update(canonicalPayload).digest("base64");
  }

  verifyCanonical(canonicalPayload: string, signature: string): boolean {
    assertNonEmptyString("canonicalPayload", canonicalPayload);
    assertStandardBase64Signature(signature);

    const expected = Buffer.from(this.signCanonical(canonicalPayload), "base64");
    const observed = Buffer.from(signature, "base64");

    return expected.length === observed.length && timingSafeEqual(expected, observed);
  }
}

export function buildDecisionReceiptSignatureEnvelope(
  receipt: UnsignedDecisionReceipt,
  signer: DecisionReceiptSigner
): DecisionReceiptSignatureEnvelope {
  assertSignerShape(signer);

  const unsigned = validateUnsignedDecisionReceipt(receipt);

  if (unsigned.signature_alg !== signer.algorithm) {
    throw signingError(`Receipt signature_alg ${unsigned.signature_alg} does not match signer algorithm ${signer.algorithm}`, {
      receiptAlgorithm: unsigned.signature_alg,
      signerAlgorithm: signer.algorithm
    });
  }

  if (signer.algorithm === kmsRsaPssAlgorithm) {
    assertNonDefaultExecutionBoundary(unsigned);
  }

  const canonicalPayload = canonicalUnsignedDecisionReceipt(unsigned);
  const signature = signer.signCanonical(canonicalPayload);
  assertStandardBase64Signature(signature);

  return {
    schemaVersion: signatureEnvelopeSchemaVersion,
    keyId: signer.keyId,
    algorithm: signer.algorithm,
    digestSha256: decisionReceiptDigest(unsigned),
    signature
  };
}

export function signDecisionReceipt(receipt: UnsignedDecisionReceipt, signer: DecisionReceiptSigner): SignedDecisionReceipt {
  const unsigned = validateUnsignedDecisionReceipt(receipt);
  const signatureEnvelope = buildDecisionReceiptSignatureEnvelope(unsigned, signer);

  return validateSignedDecisionReceipt({
    ...unsigned,
    receipt_signature: encodeDecisionReceiptSignatureEnvelope(signatureEnvelope)
  });
}