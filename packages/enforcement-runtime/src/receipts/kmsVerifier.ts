import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { constants, createPublicKey, createVerify, KeyObject } from "crypto";
import { KMS_DECISION_RECEIPT_ALGORITHM } from "./kmsSigner";
import { SignedDecisionReceipt } from "./schema";
import { DecisionReceiptCanonicalVerifier, ParsedDecisionReceiptSignatureEnvelope } from "./verifier";

export interface KmsDecisionReceiptVerifierOptions {
  keyId: string;
  client?: KMSClient;
  publicKeyPem?: string;
  publicKeyDer?: Uint8Array;
}

export class KmsDecisionReceiptVerifier implements DecisionReceiptCanonicalVerifier {
  readonly algorithm: SignedDecisionReceipt["signature_alg"] = KMS_DECISION_RECEIPT_ALGORITHM;
  readonly keyId: string;
  private readonly client?: KMSClient;
  private readonly publicKeyPem?: string;
  private readonly publicKeyDer?: Uint8Array;
  private cachedPublicKey?: KeyObject;

  constructor(options: KmsDecisionReceiptVerifierOptions) {
    this.keyId = options.keyId;
    this.client = options.client;
    this.publicKeyPem = options.publicKeyPem;
    this.publicKeyDer = options.publicKeyDer;
  }

  async verifyCanonical(
    canonicalPayload: string,
    signature: string,
    _receipt: SignedDecisionReceipt,
    envelope: ParsedDecisionReceiptSignatureEnvelope
  ): Promise<boolean> {
    if (envelope.keyId !== this.keyId) {
      return false;
    }

    const publicKey = await this.loadPublicKey();
    const verifier = createVerify("sha256");
    verifier.update(canonicalPayload);
    verifier.end();

    return verifier.verify(
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
    const response = await client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
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
