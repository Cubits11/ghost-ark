export function buildBedrockRequestBody(input: {
  modelId: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}): unknown {
  if (input.modelId.startsWith("anthropic.")) {
    return {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: input.maxTokens ?? 512,
      temperature: input.temperature ?? 0,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.prompt }]
        }
      ]
    };
  }

  return {
    inputText: input.prompt,
    textGenerationConfig: {
      maxTokenCount: input.maxTokens ?? 512,
      temperature: input.temperature ?? 0
    }
  };
}

export function extractBedrockOutputText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const body = value as Record<string, unknown>;
  const content = body.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, string>).text : ""))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof body.outputText === "string") {
    return body.outputText;
  }

  const results = body.results;
  if (Array.isArray(results)) {
    return results
      .map((result) =>
        result && typeof result === "object" && typeof (result as Record<string, unknown>).outputText === "string"
          ? (result as Record<string, string>).outputText
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }

  return "";
}
