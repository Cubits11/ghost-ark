import { KMSClient, SignCommand, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { canonicalize, sha256Bytes, sha256Hex } from "../../../packages/receipt-schema/src/hashCanonicalization";
import { ReceiptPayload, ReceiptSignature, validateReceiptPayload } from "../../../packages/receipt-schema/src/receipt";

export const defaultSigningAlgorithm: SigningAlgorithmSpec = "RSASSA_PSS_SHA_256";

export interface KmsSignerOptions {
  keyId: string;
  client?: KMSClient;
  signingAlgorithm?: SigningAlgorithmSpec;
}

export interface PayloadDigest {
  canonicalPayload: string;
  digest: Buffer;
  digestSha256: string;
}

export function digestPayloadForSigning(payload: ReceiptPayload): PayloadDigest {
  const validated = validateReceiptPayload(payload);
  const canonicalPayload = canonicalize(validated);
  const digest = sha256Bytes(canonicalPayload);
  return {
    canonicalPayload,
    digest,
    digestSha256: sha256Hex(canonicalPayload)
  };
}

export async function signReceiptPayload(payload: ReceiptPayload, options: KmsSignerOptions): Promise<ReceiptSignature> {
  const client = options.client ?? new KMSClient({});
  const algorithm = options.signingAlgorithm ?? defaultSigningAlgorithm;
  const digest = digestPayloadForSigning(payload);

  const response = await client.send(
    new SignCommand({
      KeyId: options.keyId,
      Message: digest.digest,
      MessageType: "DIGEST",
      SigningAlgorithm: algorithm
    })
  );

  if (!response.Signature) {
    throw new Error("KMS Sign returned no signature bytes");
  }

  return {
    keyId: options.keyId,
    algorithm,
    messageType: "DIGEST",
    digestSha256: digest.digestSha256,
    signatureBase64: Buffer.from(response.Signature).toString("base64"),
    signedAt: new Date().toISOString()
  };
}
