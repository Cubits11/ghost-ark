import { StorageClient } from "./storage";
import { EvidenceUploadPayload, evidenceUploadSchema } from "./schema";
import { CloudValidationError } from "./errors";
import { createHash } from "crypto";

export interface EvidenceBundleInput {
  evidenceId: string;
  tenantSlug: string;
  bucketName: string;
  data: Buffer | string;
  contentType?: string;
  tags?: Record<string, string>;
}

export class EvidenceBundleManager {
  constructor(private readonly storageClient: StorageClient) {}

  async uploadBundle(input: EvidenceBundleInput): Promise<EvidenceUploadPayload> {
    const dataBuffer = typeof input.data === "string" ? Buffer.from(input.data, "utf-8") : input.data;
    const sha256Hex = createHash("sha256").update(dataBuffer).digest("hex");
    const objectPath = `tenants/${input.tenantSlug}/evidence/${input.evidenceId}.bin`;

    await this.storageClient.upload({
      bucket: input.bucketName,
      objectPath,
      data: dataBuffer,
      contentType: input.contentType || "application/octet-stream",
      tenantSlug: input.tenantSlug,
      metadata: input.tags
    });

    const payload: EvidenceUploadPayload = {
      evidenceId: input.evidenceId,
      tenantSlug: input.tenantSlug,
      sha256Hex,
      sizeBytes: dataBuffer.length,
      contentType: input.contentType || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
      gcsUri: `gs://${input.bucketName}/${objectPath}`,
      tags: input.tags
    };

    const parsed = evidenceUploadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new CloudValidationError("Invalid evidence upload payload", { issues: parsed.error.issues });
    }
    return parsed.data;
  }

  async downloadAndVerify(bucket: string, objectPath: string, expectedSha256: string): Promise<Buffer> {
    const obj = await this.storageClient.download(bucket, objectPath);
    const actualSha256 = createHash("sha256").update(obj.data).digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new CloudValidationError(`SHA-256 mismatch for ${objectPath}: expected ${expectedSha256}, got ${actualSha256}`);
    }
    return obj.data;
  }
}
