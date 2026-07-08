import { describe, expect, it } from "vitest";
import {
  bedrockModelFamilyForModelId,
  buildBedrockRequestBody,
  extractBedrockOutputText
} from "../../../../packages/enforcement-runtime/src/bedrock/adapter";

describe("Bedrock model family adapter", () => {
  it("builds and extracts Anthropic Claude Messages payloads", () => {
    expect(
      buildBedrockRequestBody({
        modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        prompt: "hello",
        temperature: 0.2,
        maxTokens: 42
      })
    ).toEqual({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 42,
      temperature: 0.2,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }]
    });
    expect(
      extractBedrockOutputText(
        { content: [{ type: "text", text: "ok" }] },
        { modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0" }
      )
    ).toBe("ok");
  });

  it("builds and extracts Amazon Titan Text payloads", () => {
    expect(buildBedrockRequestBody({ modelId: "amazon.titan-text-lite-v1", prompt: "hello" })).toEqual({
      inputText: "hello",
      textGenerationConfig: { maxTokenCount: 512, temperature: 0 }
    });
    expect(
      extractBedrockOutputText(
        { results: [{ outputText: "titan ok" }] },
        { modelId: "amazon.titan-text-lite-v1" }
      )
    ).toBe("titan ok");
  });

  it("builds and extracts Cohere Command and Command R style payloads", () => {
    expect(buildBedrockRequestBody({ modelId: "cohere.command-text-v14", prompt: "hello", maxTokens: 16 })).toEqual({
      prompt: "hello",
      max_tokens: 16,
      temperature: 0
    });
    expect(buildBedrockRequestBody({ modelId: "cohere.command-r-v1:0", prompt: "hello", temperature: 0.1 })).toEqual({
      message: "hello",
      max_tokens: 512,
      temperature: 0.1
    });
    expect(
      extractBedrockOutputText({ generations: [{ text: "command ok" }] }, { modelId: "cohere.command-text-v14" })
    ).toBe("command ok");
    expect(extractBedrockOutputText({ text: "command r ok" }, { modelId: "cohere.command-r-v1:0" })).toBe(
      "command r ok"
    );
  });

  it("builds and extracts Mistral text instruct payloads", () => {
    expect(buildBedrockRequestBody({ modelId: "mistral.mistral-7b-instruct-v0:2", prompt: "hello" })).toEqual({
      prompt: "<s>[INST] hello [/INST]",
      max_tokens: 512,
      temperature: 0
    });
    expect(
      extractBedrockOutputText(
        { outputs: [{ text: "mistral ok" }] },
        { modelId: "mistral.mistral-7b-instruct-v0:2" }
      )
    ).toBe("mistral ok");
  });

  it("fails closed for unsupported model families unless generic JSON is explicitly allowed", () => {
    expect(() => bedrockModelFamilyForModelId("meta.llama3-8b-instruct-v1:0")).toThrow(/Unsupported Bedrock model family/u);
    expect(() => buildBedrockRequestBody({ modelId: "meta.llama3-8b-instruct-v1:0", prompt: "hello" })).toThrow(
      /Unsupported Bedrock model family/u
    );
    expect(
      buildBedrockRequestBody({
        modelId: "meta.llama3-8b-instruct-v1:0",
        prompt: "hello",
        allowGenericJson: true
      })
    ).toEqual({
      inputText: "hello",
      textGenerationConfig: { maxTokenCount: 512, temperature: 0 }
    });
  });
});
