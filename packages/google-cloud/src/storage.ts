import { createHash } from "crypto";
import { StorageError } from "./errors";
import { withRetry, RetryOptions } from "./retry";
import { CloudStorageManifest } from "./schema";

export interface StorageObject {
  bucket: string;
  objectPath: string;
  data: Buffer;
  contentType: string;
  sha256Hex: string;
  sizeBytes: number;
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface UploadOptions {
  bucket: string;
  objectPath: string;
  data: Buffer | string;
  contentType?: string;
  metadata?: Record<string, string>;
  tenantSlug: string;
  retryOptions?: RetryOptions;
}

export class MockCloudStorage {
  private readonly store = new Map<string, StorageObject>();

  async uploadObject(options: UploadOptions): Promise<CloudStorageManifest> {
    const dataBuffer = typeof options.data === "string" ? Buffer.from(options.data, "utf-8") : options.data;
    const sha256Hex = createHash("sha256").update(dataBuffer).digest("hex");
    const key = `${options.bucket}/${options.objectPath}`;
    const createdAt = new Date().toISOString();
    const contentType = options.contentType || "application/json";

    const obj: StorageObject = {
      bucket: options.bucket,
      objectPath: options.objectPath,
      data: dataBuffer,
      contentType,
      sha256Hex,
      sizeBytes: dataBuffer.length,
      createdAt,
      metadata: options.metadata
    };

    this.store.set(key, obj);

    return {
      schemaVersion: "ghost.cloud_storage_manifest.v1",
      bucket: options.bucket,
      objectPath: options.objectPath,
      sha256Hex,
      sizeBytes: dataBuffer.length,
      contentType,
      createdAt,
      tenantSlug: options.tenantSlug,
      metadata: options.metadata
    };
  }

  async getObject(bucket: string, objectPath: string): Promise<StorageObject> {
    const key = `${bucket}/${objectPath}`;
    const obj = this.store.get(key);
    if (!obj) {
      throw new StorageError(`Object not found in bucket ${bucket}: ${objectPath}`);
    }
    return obj;
  }

  async exists(bucket: string, objectPath: string): Promise<boolean> {
    return this.store.has(`${bucket}/${objectPath}`);
  }

  async listObjects(bucket: string, prefix?: string): Promise<string[]> {
    const results: string[] = [];
    const searchPrefix = prefix ? `${bucket}/${prefix}` : `${bucket}/`;
    for (const key of this.store.keys()) {
      if (key.startsWith(searchPrefix)) {
        results.push(key.replace(`${bucket}/`, ""));
      }
    }
    return results;
  }

  async deleteObject(bucket: string, objectPath: string): Promise<void> {
    const key = `${bucket}/${objectPath}`;
    this.store.delete(key);
  }
}

export class StorageClient {
  private readonly mockStorage?: MockCloudStorage;

  constructor(useMock = true) {
    if (useMock) {
      this.mockStorage = new MockCloudStorage();
    }
  }

  async upload(options: UploadOptions): Promise<CloudStorageManifest> {
    return withRetry(async () => {
      if (this.mockStorage) {
        return this.mockStorage.uploadObject(options);
      }
      throw new StorageError("Real GCS client uninitialized. Pass mock client or GCS credentials.");
    }, options.retryOptions);
  }

  async download(bucket: string, objectPath: string): Promise<StorageObject> {
    if (this.mockStorage) {
      return this.mockStorage.getObject(bucket, objectPath);
    }
    throw new StorageError("Real GCS client uninitialized.");
  }

  async exists(bucket: string, objectPath: string): Promise<boolean> {
    if (this.mockStorage) {
      return this.mockStorage.exists(bucket, objectPath);
    }
    return false;
  }
}
