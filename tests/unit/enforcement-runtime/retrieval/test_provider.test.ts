import { describe, expect, it } from "vitest";
import { NoopRetrievalProvider } from "../../../../packages/enforcement-runtime/src/retrieval/noopProvider";
import { StaticRetrievalProvider } from "../../../../packages/enforcement-runtime/src/retrieval/staticProvider";

describe("retrieval providers", () => {
  it("returns no contexts from the no-op provider", async () => {
    await expect(
      new NoopRetrievalProvider().retrieve({
        tenantId: "tenant-a",
        userId: "user-a",
        queryText: "hello",
        requestId: "request-a"
      })
    ).resolves.toEqual([]);
  });

  it("returns defensive copies from the static provider", async () => {
    const provider = new StaticRetrievalProvider([
      {
        tenantId: "tenant-a",
        digest: "sha256:" + "a".repeat(64),
        text: "hello",
        taint: ["trusted"]
      }
    ]);
    const first = await provider.retrieve({ tenantId: "tenant-a", userId: "user-a", queryText: "hello", requestId: "request-a" });
    first[0].taint.push("unknown_origin");
    const second = await provider.retrieve({ tenantId: "tenant-a", userId: "user-a", queryText: "hello", requestId: "request-a" });

    expect(second[0].taint).toEqual(["trusted"]);
  });
});
