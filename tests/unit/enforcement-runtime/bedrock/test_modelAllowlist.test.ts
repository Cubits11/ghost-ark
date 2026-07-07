import { describe, expect, it } from "vitest";
import {
  assertModelAllowed,
  isModelAllowed,
  parseModelAllowlist
} from "../../../../packages/enforcement-runtime/src/bedrock/modelAllowlist";

describe("Bedrock model allowlist", () => {
  it("parses comma-separated and JSON-array allowlists", () => {
    expect(parseModelAllowlist("anthropic.claude-a, amazon.titan-b")).toEqual(["anthropic.claude-a", "amazon.titan-b"]);
    expect(parseModelAllowlist('["anthropic.claude-a","amazon.titan-b"]')).toEqual(["anthropic.claude-a", "amazon.titan-b"]);
  });

  it("checks exact model ids only", () => {
    const allowlist = ["anthropic.claude-3-5-sonnet-20240620-v1:0"];

    expect(isModelAllowed("anthropic.claude-3-5-sonnet-20240620-v1:0", allowlist)).toBe(true);
    expect(isModelAllowed("anthropic.claude-3-haiku-20240307-v1:0", allowlist)).toBe(false);
    expect(() => assertModelAllowed("anthropic.claude-3-haiku-20240307-v1:0", allowlist)).toThrow(/allowlist/u);
  });
});
