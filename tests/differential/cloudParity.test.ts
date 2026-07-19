import { describe, it, expect } from "vitest";
import { StorageClient } from "../../packages/google-cloud/src";
import { createHash } from "crypto";

describe("Differential Test: Cloud Parity", () => {
  it("verifies hash identity between memory buffer and cloud storage digest", async () => {
    const storage = new StorageClient(true);
    const data = Buffer.from("differential-test-payload-101");
    const localHash = createHash("sha256").update(data).digest("hex");

    const manifest = await storage.upload({
      bucket: "ghost-ark-differential",
      objectPath: "diff/101.bin",
      data,
      tenantSlug: "acme-corp"
    });

    expect(manifest.sha256Hex).toBe(localHash);
  });
});
