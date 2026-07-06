import { KMSClient, VerifyCommand, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { ReceiptPayload, ReceiptSignature, validateReceiptPayload } from "../../../packages/receipt-schema/src/receipt";
import { digestPayloadForSigning } from "./signer";

export interface KmsVerifierOptions {
  client?: KMSClient;
}

export async function verifyReceiptSignature(
  payload: ReceiptPayload,
  signature: ReceiptSignature,
  options: KmsVerifierOptions = {}
): Promise<boolean> {
  const validated = validateReceiptPayload(payload);
  const digest = digestPayloadForSigning(validated);

  if (digest.digestSha256 !== signature.digestSha256) {
    return false;
  }

  const client = options.client ?? new KMSClient({});
  const response = await client.send(
    new VerifyCommand({
      KeyId: signature.keyId,
      Message: digest.digest,
      MessageType: "DIGEST",
      Signature: Buffer.from(signature.signatureBase64, "base64"),
      SigningAlgorithm: signature.algorithm as SigningAlgorithmSpec
    })
  );

  return response.SignatureValid === true;
}
