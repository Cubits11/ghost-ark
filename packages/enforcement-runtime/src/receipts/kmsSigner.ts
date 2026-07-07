import {
  DescribeKeyCommand,
  DescribeKeyCommandOutput,
  KMSClient,
  SignCommand,
  SignCommandOutput
} from "@aws-sdk/client-kms";
import { sha256Bytes } from "../../../receipt-schema/src/hashCanonicalization";
import type { DecisionReceiptAsyncSigner } from "./emission";
import { SignedDecisionReceipt } from "./schema";

export const KMS_DECISION_RECEIPT_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256" as const;
export const KMS_DECISION_RECEIPT_SIGNING_ALGORITHM = "RSASSA_PSS_SHA_256" as const;
export const KMS_DECISION_RECEIPT_MESSAGE_TYPE = "DIGEST" as const;

const KMS_KEY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_KEY_ARN_PATTERN =
  /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_ALIAS_ARN_PATTERN = /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:alias\/.+$/iu;

export interface KmsDecisionReceiptSignerOptions {
  keyId: string;
  client?: KMSClient;
}

export function isKmsAliasKeyId(keyId: string): boolean {
  return keyId.startsWith("alias/") || KMS_ALIAS_ARN_PATTERN.test(keyId);
}

export function isImmutableKmsKeyId(keyId: string): boolean {
  return KMS_KEY_UUID_PATTERN.test(keyId) || KMS_KEY_ARN_PATTERN.test(keyId);
}

export function immutableKmsKeyIdsMatch(first: string, second: string): boolean {
  if (!isImmutableKmsKeyId(first) || !isImmutableKmsKeyId(second)) {
    return false;
  }
  if (KMS_KEY_ARN_PATTERN.test(first) && KMS_KEY_ARN_PATTERN.test(second)) {
    return first === second;
  }
  return keyUuidFromImmutableKeyId(first) === keyUuidFromImmutableKeyId(second);
}

export function keyUuidFromImmutableKeyId(keyId: string): string {
  return keyId.includes(":key/") ? keyId.slice(keyId.lastIndexOf("/") + 1) : keyId;
}

export async function resolveImmutableKmsKeyId(client: KMSClient, keyId: string): Promise<string> {
  if (isImmutableKmsKeyId(keyId)) {
    return keyId;
  }
  if (!isKmsAliasKeyId(keyId)) {
    throw new Error(`KMS decision receipt keyId must be an immutable key ARN, key UUID, or alias: ${keyId}`);
  }

  const response = await client.send(new DescribeKeyCommand({ KeyId: keyId }));
  return immutableKeyIdFromDescribeKey(response, keyId);
}

function immutableKeyIdFromDescribeKey(response: DescribeKeyCommandOutput, requestedKeyId: string): string {
  const arn = response.KeyMetadata?.Arn;
  if (arn && isImmutableKmsKeyId(arn)) {
    return arn;
  }

  const keyId = response.KeyMetadata?.KeyId;
  if (keyId && isImmutableKmsKeyId(keyId)) {
    return keyId;
  }

  throw new Error(`KMS DescribeKey did not return an immutable backing key for ${requestedKeyId}`);
}

function immutableKeyIdFromSign(response: SignCommandOutput): string | undefined {
  return typeof response.KeyId === "string" && isImmutableKmsKeyId(response.KeyId) ? response.KeyId : undefined;
}

export class KmsDecisionReceiptSigner implements DecisionReceiptAsyncSigner {
  readonly algorithm: SignedDecisionReceipt["signature_alg"] = KMS_DECISION_RECEIPT_ALGORITHM;
  keyId: string;
  private readonly client: KMSClient;
  private readonly configuredKeyId: string;
  private resolvedKeyId?: string;
  private keyIdResolution?: Promise<string>;

  constructor(options: KmsDecisionReceiptSignerOptions) {
    this.keyId = options.keyId;
    this.configuredKeyId = options.keyId;
    this.client = options.client ?? new KMSClient({});
  }

  async signCanonical(canonicalPayload: string): Promise<string> {
    const keyId = await this.resolveSigningKeyId();
    const response = await this.client.send(
      new SignCommand({
        KeyId: keyId,
        Message: sha256Bytes(canonicalPayload),
        MessageType: KMS_DECISION_RECEIPT_MESSAGE_TYPE,
        SigningAlgorithm: KMS_DECISION_RECEIPT_SIGNING_ALGORITHM
      })
    );
    if (!response.Signature) {
      throw new Error("KMS Sign returned no decision receipt signature bytes");
    }
    const responseKeyId = immutableKeyIdFromSign(response);
    if (responseKeyId) {
      this.resolvedKeyId = responseKeyId;
      this.keyId = responseKeyId;
    }
    if (!isImmutableKmsKeyId(this.keyId)) {
      throw new Error(`KMS Sign did not bind decision receipt to an immutable key identity: ${this.keyId}`);
    }
    return Buffer.from(response.Signature).toString("base64");
  }

  private async resolveSigningKeyId(): Promise<string> {
    if (this.resolvedKeyId) {
      return this.resolvedKeyId;
    }
    this.keyIdResolution ??= resolveImmutableKmsKeyId(this.client, this.configuredKeyId).then((resolvedKeyId) => {
      this.resolvedKeyId = resolvedKeyId;
      this.keyId = resolvedKeyId;
      return resolvedKeyId;
    });
    return this.keyIdResolution;
  }
}
