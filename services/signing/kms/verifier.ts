import { KMSClient, VerifyCommand, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { constants, createPublicKey, verify as verifySignature } from "crypto";
import { ReceiptPayload, ReceiptSignature, validateReceiptPayload } from "../../../packages/receipt-schema/src/receipt";
import { immutableKmsKeyIdsMatch, isImmutableKmsKeyId } from "../../../packages/enforcement-runtime/src/aws/kmsKeyIdentity";
import { defaultSigningAlgorithm, digestPayloadForSigning } from "./signer";

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
  if (!isImmutableKmsKeyId(signature.keyId)) {
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
  if (typeof response.KeyId === "string" && !immutableKmsKeyIdsMatch(response.KeyId, signature.keyId)) {
    return false;
  }
  if (
    typeof response.SigningAlgorithm === "string" &&
    response.SigningAlgorithm !== signature.algorithm
  ) {
    return false;
  }

  return response.SignatureValid === true;
}

export function verifyReceiptSignatureWithPublicKey(
  payload: ReceiptPayload,
  signature: ReceiptSignature,
  publicKeyPem: string
): boolean {
  const validated = validateReceiptPayload(payload);
  const digest = digestPayloadForSigning(validated);

  if (digest.digestSha256 !== signature.digestSha256) {
    return false;
  }
  if (!isImmutableKmsKeyId(signature.keyId)) {
    return false;
  }
  if (signature.messageType !== "DIGEST" || signature.algorithm !== defaultSigningAlgorithm) {
    return false;
  }

  return verifySignature(
    null,
    digest.digest,
    {
      key: createPublicKey(publicKeyPem),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST
    },
    Buffer.from(signature.signatureBase64, "base64")
  );
}
