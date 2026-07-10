import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  toGuardrailTelemetryAttributes,
  validateGuardrailObservation,
} from "../../../packages/research-frontier/src/guardrailObservation";

const fixtureRoot = "examples/research/guardrail-observations";

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8")) as unknown;
}

describe("guardrail observation research contract", () => {
  it.each([
    "valid-unbound.json",
    "valid-declared-receipt-reference.json",
  ])("accepts valid fixture %s", (name) => {
    expect(() => validateGuardrailObservation(readFixture(name))).not.toThrow();
  });

  it.each([
    "invalid-raw-content-flag.json",
    "invalid-incomplete-receipt-reference.json",
  ])("rejects deliberately invalid fixture %s", (name) => {
    expect(() => validateGuardrailObservation(readFixture(name))).toThrow();
  });

  it("rejects a score outside its declared numeric bounds", () => {
    const value = readFixture("valid-unbound.json") as Record<string, unknown>;
    const result = value.result as {
      scores: Array<Record<string, unknown>>;
    };
    result.scores[0].value = 1.1;

    expect(() => validateGuardrailObservation(value)).toThrow(
      /inside the declared bounds/i,
    );
  });

  it("rejects results with neither a score nor a categorical finding", () => {
    const value = readFixture("valid-unbound.json") as Record<string, unknown>;
    const result = value.result as {
      scores: unknown[];
      findings: unknown[];
    };
    result.scores = [];
    result.findings = [];

    expect(() => validateGuardrailObservation(value)).toThrow(
      /at least one score or finding/i,
    );
  });

  it("rejects partial OpenTelemetry trace context", () => {
    const value = readFixture("valid-unbound.json") as Record<string, unknown>;
    const telemetry = value.telemetry as Record<string, unknown>;
    telemetry.span_id = null;

    expect(() => validateGuardrailObservation(value)).toThrow(
      /must both be present or both be null/i,
    );
  });

  it("maps only bounded metadata to telemetry attributes by default", () => {
    const value = readFixture("valid-unbound.json");
    const attributes = toGuardrailTelemetryAttributes(value);
    const serialized = JSON.stringify(attributes);

    expect(attributes).toMatchObject({
      "ghostark.guardrail.id": "toxicity-filter",
      "ghostark.guardrail.outcome": "flag",
      "ghostark.guardrail.score_count": 1,
      "ghostark.receipt.binding_status": "unbound",
    });
    expect(serialized).not.toContain("tenant_id_hash");
    expect(serialized).not.toContain("request_id_hash");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("completion");
    expect(serialized).not.toContain("receipt_digest");
  });

  it("exports pseudonymous scope only through an explicit option", () => {
    const value = readFixture("valid-unbound.json");
    const attributes = toGuardrailTelemetryAttributes(value, {
      includePseudonymousScope: true,
    });

    expect(attributes["ghostark.tenant.id_hash"]).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/,
    );
    expect(attributes["ghostark.request.id_hash"]).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/,
    );
  });

  it("keeps the JSON Schema privacy and receipt-reference boundary explicit", () => {
    const schema = JSON.parse(
      readFileSync("schemas/research/guardrail-observation.schema.json", "utf8"),
    ) as {
      additionalProperties: boolean;
      properties: {
        content_evidence: {
          properties: { raw_content_included: { const: boolean } };
        };
        receipt_binding: { oneOf: unknown[] };
      };
    };

    expect(schema.additionalProperties).toBe(false);
    expect(
      schema.properties.content_evidence.properties.raw_content_included.const,
    ).toBe(false);
    expect(schema.properties.receipt_binding.oneOf).toHaveLength(2);
  });
});
