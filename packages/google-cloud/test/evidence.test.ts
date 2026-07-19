import { describe, it, expect } from "vitest";
import { StorageClient } from "../src/storage";
import { EvidenceBundleManager } from "../src/evidence";

describe("EvidenceBundleManager", () => {
  it("uploads, verifies and downloads evidence bundle", async () => {
    const storageClient = new StorageClient(true);
    const manager = new EvidenceBundleManager(storageClient);

    const payload = await manager.uploadBundle({
      evidenceId: "ev-bundle-99",
      tenantSlug: "acme-corp",
      bucketName: "ghost-ark-evidence",
      data: "critical-evidence-data",
      contentType: "text/plain"
    });

    expect(payload.evidenceId).toBe("ev-bundle-99");
    expect(payload.gcsUri).toContain("ev-bundle-99.bin");

    const downloaded = await manager.downloadAndVerify(
      "ghost-ark-evidence",
      "tenants/acme-corp/evidence/ev-bundle-99.bin",
      payload.sha256Hex
    );

    expect(downloaded.toString("utf-8")).toBe("critical-evidence-data");
  });
});
