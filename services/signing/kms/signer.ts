import { KMSClient, SignCommand, SignCommandOutput, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { canonicalize, sha256Bytes, sha256Hex } from "../../../packages/receipt-schema/src/hashCanonicalization";
import { ReceiptPayload, ReceiptSignature, validateReceiptPayload } from "../../../packages/receipt-schema/src/receipt";
import {
  assertImmutableKmsKeyId,
  immutableKmsKeyIdsMatch,
  isImmutableKmsKeyId
} from "../../../packages/enforcement-runtime/src/aws/kmsKeyIdentity";

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

function immutableKeyIdFromSign(response: SignCommandOutput): string | undefined {
  return typeof response.KeyId === "string" && isImmutableKmsKeyId(response.KeyId) ? response.KeyId : undefined;
}

export async function signReceiptPayload(payload: ReceiptPayload, options: KmsSignerOptions): Promise<ReceiptSignature> {
  const client = options.client ?? new KMSClient({});
  const algorithm = options.signingAlgorithm ?? defaultSigningAlgorithm;
  const keyId = assertImmutableKmsKeyId(options.keyId, "KMS evidence receipt signer keyId");
  const digest = digestPayloadForSigning(payload);

  const response = await client.send(
    new SignCommand({
      KeyId: keyId,
      Message: digest.digest,
      MessageType: "DIGEST",
      SigningAlgorithm: algorithm
    })
  );

  if (!response.Signature) {
    throw new Error("KMS Sign returned no signature bytes");
  }
  const responseKeyId = immutableKeyIdFromSign(response);
  if (!responseKeyId) {
    throw new Error("KMS Sign did not attest an immutable evidence receipt key identity");
  }
  if (!immutableKmsKeyIdsMatch(keyId, responseKeyId)) {
    throw new Error(`KMS Sign attested an unexpected evidence receipt key identity: ${responseKeyId}`);
  }

  return {
    keyId: responseKeyId,
    algorithm,
    messageType: "DIGEST",
    digestSha256: digest.digestSha256,
    signatureBase64: Buffer.from(response.Signature).toString("base64"),
    signedAt: new Date().toISOString()
  };
}
