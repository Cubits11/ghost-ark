import { KMSClient, SignCommand, SignCommandOutput } from "@aws-sdk/client-kms";
import { sha256Bytes } from "../../../receipt-schema/src/hashCanonicalization";
import {
  assertImmutableKmsKeyId,
  immutableKmsKeyIdsMatch,
  isImmutableKmsKeyId
} from "../aws/kmsKeyIdentity";
import type { DecisionReceiptAsyncSigner } from "./emission";
import { SignedDecisionReceipt } from "./schema";

export {
  assertImmutableKmsKeyId,
  immutableKmsKeyIdsMatch,
  isImmutableKmsKeyId,
  isKmsAliasKeyId,
  keyUuidFromImmutableKeyId
} from "../aws/kmsKeyIdentity";

export const KMS_DECISION_RECEIPT_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256" as const;
export const KMS_DECISION_RECEIPT_SIGNING_ALGORITHM = "RSASSA_PSS_SHA_256" as const;
export const KMS_DECISION_RECEIPT_MESSAGE_TYPE = "DIGEST" as const;

export interface KmsDecisionReceiptSignerOptions {
  keyId: string;
  client?: KMSClient;
}

function immutableKeyIdFromSign(response: SignCommandOutput): string | undefined {
  return typeof response.KeyId === "string" && isImmutableKmsKeyId(response.KeyId) ? response.KeyId : undefined;
}

export class KmsDecisionReceiptSigner implements DecisionReceiptAsyncSigner {
  readonly algorithm: SignedDecisionReceipt["signature_alg"] = KMS_DECISION_RECEIPT_ALGORITHM;
  keyId: string;
  private readonly client: KMSClient;

  constructor(options: KmsDecisionReceiptSignerOptions) {
    this.keyId = assertImmutableKmsKeyId(options.keyId, "KMS decision receipt signer keyId");
    this.client = options.client ?? new KMSClient({});
  }

  async signCanonical(canonicalPayload: string): Promise<string> {
    const response = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: sha256Bytes(canonicalPayload),
        MessageType: KMS_DECISION_RECEIPT_MESSAGE_TYPE,
        SigningAlgorithm: KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
      })
    );
    if (!response.Signature) {
      throw new Error("KMS Sign returned no decision receipt signature bytes");
    }
    const responseKeyId = immutableKeyIdFromSign(response);
    if (!responseKeyId) {
      throw new Error("KMS Sign did not attest an immutable decision receipt key identity");
    }
    if (!immutableKmsKeyIdsMatch(this.keyId, responseKeyId)) {
      throw new Error(`KMS Sign attested an unexpected decision receipt key identity: ${responseKeyId}`);
    }
    this.keyId = responseKeyId;
    return Buffer.from(response.Signature).toString("base64");
  }
}
