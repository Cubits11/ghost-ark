import { z } from "zod";

export const cloudStorageManifestSchema = z.object({
  schemaVersion: z.literal("ghost.cloud_storage_manifest.v1"),
  bucket: z.string().min(1),
  objectPath: z.string().min(1),
  sha256Hex: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
  contentType: z.string().min(1),
  createdAt: z.string().datetime(),
  tenantSlug: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),
  metadata: z.record(z.unknown()).optional()
});

export const bigQueryReceiptRowSchema = z.object({
  receipt_id: z.string().regex(/^rct_[a-f0-9]{64}$/),
  tenant_slug: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),
  issued_at: z.string(),
  subject_kind: z.enum(["evidence-object", "dataset-version", "claim", "export-pack", "transform-run"]),
  subject_id: z.string().min(1),
  subject_uri: z.string().optional(),
  digest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  signature_key_id: z.string().min(1),
  signature_base64: z.string().optional(),
  status: z.enum(["issued", "superseded", "revoked", "disputed"]),
  gcs_uri: z.string(),
  ingested_at: z.string(),
  merkle_leaf_index: z.number().int().min(0).optional(),
  raw_json: z.string().optional()
});

export const evidenceUploadSchema = z.object({
  evidenceId: z.string().min(1),
  tenantSlug: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),
  sha256Hex: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().min(0),
  contentType: z.string().min(1),
  uploadedAt: z.string(),
  gcsUri: z.string(),
  tags: z.record(z.string()).optional()
});

export type CloudStorageManifest = z.infer<typeof cloudStorageManifestSchema>;
export type BigQueryReceiptRow = z.infer<typeof bigQueryReceiptRowSchema>;
export type EvidenceUploadPayload = z.infer<typeof evidenceUploadSchema>;
