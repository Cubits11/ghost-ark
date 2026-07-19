import { describe, it, expect } from "vitest";
import { StorageClient } from "../src/storage";

describe("StorageClient", () => {
  it("uploads and retrieves an object in mock storage mode", async () => {
    const client = new StorageClient(true);
    const manifest = await client.upload({
      bucket: "test-bucket",
      objectPath: "sample.json",
      data: JSON.stringify({ hello: "world" }),
      contentType: "application/json",
      tenantSlug: "acme-corp"
    });

    expect(manifest.bucket).toBe("test-bucket");
    expect(manifest.objectPath).toBe("sample.json");
    expect(manifest.tenantSlug).toBe("acme-corp");
    expect(manifest.sha256Hex).toHaveLength(64);

    const exists = await client.exists("test-bucket", "sample.json");
    expect(exists).toBe(true);

    const downloaded = await client.download("test-bucket", "sample.json");
    expect(downloaded.data.toString("utf-8")).toContain("world");
  });
});
