import { describe, it, expect } from "vitest";
import { StorageClient, EvidenceBundleManager } from "../../../packages/google-cloud/src";

describe("Integration: Receipt Recovery", () => {
  it("reconstructs evidence state from storage objects", async () => {
    const storage = new StorageClient(true);
    const manager = new EvidenceBundleManager(storage);

    const payload = await manager.uploadBundle({
      evidenceId: "ev-recover-1",
      tenantSlug: "acme-corp",
      bucketName: "ghost-ark-evidence",
      data: "evidence-payload-data"
    });

    const downloaded = await manager.downloadAndVerify(
      "ghost-ark-evidence",
      "tenants/acme-corp/evidence/ev-recover-1.bin",
      payload.sha256Hex
    );

    expect(downloaded.toString("utf-8")).toBe("evidence-payload-data");
  });
});
