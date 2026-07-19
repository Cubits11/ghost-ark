import { describe, it, expect } from "vitest";
import { StorageClient } from "../../../packages/google-cloud/src";

describe("Integration: Cloud Storage Bucket Upload", () => {
  it("stores object idempotently and generates valid sha256 manifest", async () => {
    const storage = new StorageClient(true);
    const manifest = await storage.upload({
      bucket: "ghost-ark-test-bucket",
      objectPath: "evidence/101.bin",
      data: Buffer.from("payload-content"),
      tenantSlug: "acme-test"
    });

    expect(manifest.bucket).toBe("ghost-ark-test-bucket");
    expect(manifest.sha256Hex).toBeDefined();

    const exists = await storage.exists("ghost-ark-test-bucket", "evidence/101.bin");
    expect(exists).toBe(true);
  });
});
