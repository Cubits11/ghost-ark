import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface MappingControl {
  mapping_id: string;
  framework: "NIST AI RMF" | "ISO/IEC 42001";
  reference: string;
  title: string;
  status: string;
  evidence_artifacts: string[];
  limitation: string;
  reviewer_caveat: string;
}

interface ControlMapping {
  schema_version: string;
  snapshot_date: string;
  scope: string;
  sources: Array<{ framework: string; version: string; url: string; note: string }>;
  controls: MappingControl[];
  non_claims: string[];
}

describe("framework control mapping", () => {
  const mapping = JSON.parse(
    readFileSync("docs/compliance/control-mapping.json", "utf8")
  ) as ControlMapping;

  it("covers all NIST AI RMF functions and ISO/IEC 42001 clauses 4 through 10", () => {
    expect(mapping.schema_version).toBe("ghost.framework_control_mapping.v1");
    expect(mapping.controls.filter((control) => control.framework === "NIST AI RMF").map((control) => control.reference)).toEqual([
      "GOVERN",
      "MAP",
      "MEASURE",
      "MANAGE"
    ]);
    expect(mapping.controls.filter((control) => control.framework === "ISO/IEC 42001").map((control) => control.reference)).toEqual([
      "Clause 4",
      "Clause 5",
      "Clause 6",
      "Clause 7",
      "Clause 8",
      "Clause 9",
      "Clause 10"
    ]);
  });

  it("gives every mapping evidence, a limitation, and a reviewer caveat", () => {
    const ids = new Set<string>();
    for (const control of mapping.controls) {
      expect(ids.has(control.mapping_id)).toBe(false);
      ids.add(control.mapping_id);
      expect(control.evidence_artifacts.length).toBeGreaterThan(0);
      expect(control.limitation.length).toBeGreaterThan(40);
      expect(control.reviewer_caveat.length).toBeGreaterThan(30);
      for (const artifact of control.evidence_artifacts) {
        expect(existsSync(artifact), `${control.mapping_id} missing ${artifact}`).toBe(true);
      }
    }
  });

  it("pins official source versions and explicit non-claims", () => {
    expect(mapping.sources.some((source) => source.framework === "NIST AI RMF" && source.version === "1.0")).toBe(true);
    expect(mapping.sources.some((source) => source.framework === "ISO/IEC 42001" && source.version.includes("2023"))).toBe(true);
    expect(mapping.non_claims.join(" ")).toMatch(/does not certify|does not.*conformity/u);
    expect(mapping.non_claims.join(" ")).toMatch(/under revision/u);
  });
});
