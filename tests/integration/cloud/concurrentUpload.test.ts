import { describe, it, expect } from "vitest";
import { StorageClient } from "../../../packages/google-cloud/src";

describe("Integration: Concurrent Uploads", () => {
  it("handles parallel uploads without resource contention or corruption", async () => {
    const storage = new StorageClient(true);
    const uploads = Array.from({ length: 5 }, (_, i) =>
      storage.upload({
        bucket: "ghost-ark-concurrent",
        objectPath: `obj-${i}.txt`,
        data: `content-${i}`,
        tenantSlug: "acme-corp"
      })
    );

    const manifests = await Promise.all(uploads);
    expect(manifests).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(manifests[i].objectPath).toBe(`obj-${i}.txt`);
    }
  });
});
