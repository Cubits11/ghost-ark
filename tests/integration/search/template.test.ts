import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildBulkIndexPayload } from "../../../services/search/opensearch/ingestion/indexEvidence";

describe("OpenSearch evidence template", () => {
  it("keeps tenantSlug as a keyword filter field", () => {
    const template = JSON.parse(fs.readFileSync(path.join(process.cwd(), "services/search/opensearch/index_templates/evidence-template.json"), "utf8"));
    expect(template.template.mappings.properties.tenantSlug.type).toBe("keyword");
  });

  it("builds newline-delimited bulk payloads", () => {
    const payload = buildBulkIndexPayload("ghost-ark-dev-acme-lab", [
      {
        id: "ev_1",
        tenantSlug: "acme-lab",
        title: "Evidence",
        body: "Body",
        objectUri: "s3://bucket/key",
        observedAt: "2026-07-06T12:00:00.000Z"
      }
    ]);
    expect(payload.endsWith("\n")).toBe(true);
    expect(payload.split("\n")[0]).toContain("ghost-ark-dev-acme-lab");
  });
});
