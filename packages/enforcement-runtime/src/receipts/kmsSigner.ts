import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { sha256Bytes } from "../../../receipt-schema/src/hashCanonicalization";
import type { DecisionReceiptAsyncSigner } from "./emission";
import { SignedDecisionReceipt } from "./schema";

export const KMS_DECISION_RECEIPT_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256" as const;

export interface KmsDecisionReceiptSignerOptions {
  keyId: string;
  client?: KMSClient;
}

export class KmsDecisionReceiptSigner implements DecisionReceiptAsyncSigner {
  readonly algorithm: SignedDecisionReceipt["signature_alg"] = KMS_DECISION_RECEIPT_ALGORITHM;
  readonly keyId: string;
  private readonly client: KMSClient;

  constructor(options: KmsDecisionReceiptSignerOptions) {
    this.keyId = options.keyId;
    this.client = options.client ?? new KMSClient({});
  }

  async signCanonical(canonicalPayload: string): Promise<string> {
    const response = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: sha256Bytes(canonicalPayload),
        MessageType: "DIGEST",
        SigningAlgorithm: "RSASSA_PSS_SHA_256"
      })
    );
    if (!response.Signature) {
      throw new Error("KMS Sign returned no decision receipt signature bytes");
    }
    return Buffer.from(response.Signature).toString("base64");
  }
}
