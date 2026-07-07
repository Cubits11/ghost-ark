import { GetPublicKeyCommand, KMSClient, VerifyCommand } from "@aws-sdk/client-kms";
import { constants, createPublicKey, KeyObject, verify as verifySignature } from "crypto";
import { sha256Bytes } from "../../../receipt-schema/src/hashCanonicalization";
import {
  immutableKmsKeyIdsMatch,
  isImmutableKmsKeyId,
  isKmsAliasKeyId,
  KMS_DECISION_RECEIPT_ALGORITHM,
  KMS_DECISION_RECEIPT_MESSAGE_TYPE,
  KMS_DECISION_RECEIPT_SIGNING_ALGORITHM,
  resolveImmutableKmsKeyId
} from "./kmsSigner";
import { SignedDecisionReceipt } from "./schema";
import { DecisionReceiptCanonicalVerifier, ParsedDecisionReceiptSignatureEnvelope } from "./verifier";

export interface KmsDecisionReceiptVerifierLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface KmsDecisionReceiptVerifierOptions {
  keyId: string;
  client?: KMSClient;
  publicKeyPem?: string;
  publicKeyDer?: Uint8Array;
  logger?: KmsDecisionReceiptVerifierLogger;
}

export class KmsDecisionReceiptVerifier implements DecisionReceiptCanonicalVerifier {
  readonly algorithm: SignedDecisionReceipt["signature_alg"] = KMS_DECISION_RECEIPT_ALGORITHM;
  readonly keyId?: string;
  private readonly configuredKeyId: string;
  private readonly client?: KMSClient;
  private readonly publicKeyPem?: string;
  private readonly publicKeyDer?: Uint8Array;
  private readonly logger?: KmsDecisionReceiptVerifierLogger;
  private cachedPublicKey?: KeyObject;

  constructor(options: KmsDecisionReceiptVerifierOptions) {
    this.configuredKeyId = options.keyId;
    this.keyId = isImmutableKmsKeyId(options.keyId) ? options.keyId : undefined;
    this.client = options.client;
    this.publicKeyPem = options.publicKeyPem;
    this.publicKeyDer = options.publicKeyDer;
    this.logger = options.logger;
  }

  async verifyCanonical(
    canonicalPayload: string,
    signature: string,
    _receipt: SignedDecisionReceipt,
    envelope: ParsedDecisionReceiptSignatureEnvelope
  ): Promise<boolean> {
    const receiptKeyId = typeof envelope.keyId === "string" ? envelope.keyId : "";
    const keyId = await this.resolveReceiptKeyId(receiptKeyId);
    if (!keyId) {
      return false;
    }
    if (this.keyId && !immutableKmsKeyIdsMatch(this.keyId, keyId)) {
      return false;
    }

    if (this.publicKeyPem || this.publicKeyDer) {
      return this.verifyWithConfiguredPublicKey(canonicalPayload, signature);
    }

    const client = this.client ?? new KMSClient({});
    const response = await client.send(
      new VerifyCommand({
        KeyId: keyId,
        Message: sha256Bytes(canonicalPayload),
        MessageType: KMS_DECISION_RECEIPT_MESSAGE_TYPE,
        Signature: Buffer.from(signature, "base64"),
        SigningAlgorithm: KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
      })
    );
    if (
      typeof response.SigningAlgorithm === "string" &&
      response.SigningAlgorithm !== KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
    ) {
      return false;
    }
    if (typeof response.KeyId === "string" && !immutableKmsKeyIdsMatch(response.KeyId, keyId)) {
      return false;
    }
    return response.SignatureValid === true;
  }

  private async resolveReceiptKeyId(receiptKeyId: string): Promise<string | undefined> {
    if (isImmutableKmsKeyId(receiptKeyId)) {
      return receiptKeyId;
    }
    if (!isKmsAliasKeyId(receiptKeyId)) {
      return undefined;
    }

    this.warnMutableAliasReceipt(receiptKeyId);
    const client = this.client ?? new KMSClient({});
    return resolveImmutableKmsKeyId(client, receiptKeyId);
  }

  private warnMutableAliasReceipt(receiptKeyId: string): void {
    const fields = {
      event: "kms_decision_receipt_mutable_alias_key_id",
      configuredKeyId: this.configuredKeyId,
      receiptKeyId
    };
    if (this.logger) {
      this.logger.warn("KMS decision receipt contains mutable alias keyId; resolving alias before verification.", fields);
      return;
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "KMS decision receipt contains mutable alias keyId; resolving alias before verification.",
        ...fields
      })
    );
  }

  private async verifyWithConfiguredPublicKey(canonicalPayload: string, signature: string): Promise<boolean> {
    const publicKey = await this.loadPublicKey();
    return verifySignature(
      null,
      Buffer.from(sha256Bytes(canonicalPayload)),
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      },
      Buffer.from(signature, "base64")
    );
  }

  private async loadPublicKey(): Promise<KeyObject> {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey;
    }
    if (this.publicKeyPem) {
      this.cachedPublicKey = createPublicKey(this.publicKeyPem);
      return this.cachedPublicKey;
    }
    if (this.publicKeyDer) {
      this.cachedPublicKey = createPublicKey({
        key: Buffer.from(this.publicKeyDer),
        format: "der",
        type: "spki"
      });
      return this.cachedPublicKey;
    }

    const client = this.client ?? new KMSClient({});
    const response = await client.send(new GetPublicKeyCommand({ KeyId: this.configuredKeyId }));
    if (!response.PublicKey) {
      throw new Error("KMS GetPublicKey returned no public key bytes");
    }
    this.cachedPublicKey = createPublicKey({
      key: Buffer.from(response.PublicKey),
      format: "der",
      type: "spki"
    });
    return this.cachedPublicKey;
  }
}
