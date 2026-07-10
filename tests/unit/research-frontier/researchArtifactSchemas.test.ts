import { readFileSync } from "node:fs";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function validator(schemaPath: string) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictTuples: false
  });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath) as AnySchema);
}

describe("research artifact JSON Schemas", () => {
  it("validates the guardrail examples and rejects the deliberate invalid fixtures", () => {
    const validate = validator("schemas/research/guardrail-observation.schema.json");
    for (const name of ["valid-unbound.json", "valid-declared-receipt-reference.json"]) {
      expect(validate(readJson(`examples/research/guardrail-observations/${name}`)), JSON.stringify(validate.errors)).toBe(true);
    }
    for (const name of ["invalid-raw-content-flag.json", "invalid-incomplete-receipt-reference.json"]) {
      expect(validate(readJson(`examples/research/guardrail-observations/${name}`)), name).toBe(false);
    }
  });

  it("validates the queue, decision, and incident examples against their portable schemas", () => {
    const cases = [
      ["schemas/research/human-review-queue-item.schema.json", "examples/research/human-review/false-positive-queue-item.json"],
      ["schemas/research/human-review-queue-item.schema.json", "examples/research/human-review/escalated-queue-item.json"],
      ["schemas/research/human-review-decision.schema.json", "examples/research/human-review/false-positive-decision.json"],
      ["schemas/research/human-review-decision.schema.json", "examples/research/human-review/escalated-decision.json"],
      ["schemas/research/incident-report.schema.json", "examples/research/human-review/example-incident.json"]
    ];
    for (const [schemaPath, examplePath] of cases) {
      const validate = validator(schemaPath);
      expect(validate(readJson(examplePath)), `${examplePath}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("validates the CC export, CC report, and candidate control mapping examples", () => {
    const cases = [
      ["schemas/research/cc-binary-observation.schema.json", "examples/cc-ghost/binary-observation.example.json"],
      ["schemas/research/cc-correlation-report.schema.json", "examples/cc-ghost/correlation-report.example.json"],
      ["schemas/compliance/control-mapping.schema.json", "docs/compliance/control-mapping.json"]
    ];
    for (const [schemaPath, examplePath] of cases) {
      const validate = validator(schemaPath);
      expect(validate(readJson(examplePath)), `${examplePath}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});
