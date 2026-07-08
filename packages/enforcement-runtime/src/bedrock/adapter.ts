import { ValidationError } from "../../../shared/src/errors";

export type BedrockModelFamily =
  | "anthropic_claude_messages"
  | "amazon_titan_text"
  | "cohere_command"
  | "cohere_command_r"
  | "mistral_text_instruct"
  | "generic_json";

export interface BedrockAdapterOptions {
  allowGenericJson?: boolean;
}

export function bedrockModelFamilyForModelId(modelId: string, options: BedrockAdapterOptions = {}): BedrockModelFamily {
  const normalized = modelId.toLowerCase();
  if (normalized.startsWith("anthropic.")) {
    return "anthropic_claude_messages";
  }
  if (normalized.startsWith("amazon.titan-text")) {
    return "amazon_titan_text";
  }
  if (normalized.startsWith("cohere.command-r")) {
    return "cohere_command_r";
  }
  if (normalized.startsWith("cohere.command")) {
    return "cohere_command";
  }
  if (normalized.startsWith("mistral.")) {
    return "mistral_text_instruct";
  }
  if (options.allowGenericJson === true) {
    return "generic_json";
  }
  throw new ValidationError("Unsupported Bedrock model family for governed invoke adapter", { modelId });
}

export function buildBedrockRequestBody(input: {
  modelId: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  allowGenericJson?: boolean;
}): unknown {
  const maxTokens = input.maxTokens ?? 512;
  const temperature = input.temperature ?? 0;
  const family = bedrockModelFamilyForModelId(input.modelId, { allowGenericJson: input.allowGenericJson });

  if (family === "anthropic_claude_messages") {
    return {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.prompt }]
        }
      ]
    };
  }

  if (family === "amazon_titan_text" || family === "generic_json") {
    return {
      inputText: input.prompt,
      textGenerationConfig: {
        maxTokenCount: maxTokens,
        temperature
      }
    };
  }

  if (family === "cohere_command") {
    return {
      prompt: input.prompt,
      max_tokens: maxTokens,
      temperature
    };
  }

  if (family === "cohere_command_r") {
    return {
      message: input.prompt,
      max_tokens: maxTokens,
      temperature
    };
  }

  return {
    prompt: `<s>[INST] ${input.prompt} [/INST]`,
    max_tokens: maxTokens,
    temperature
  };
}

function joinedTextFromArray(value: unknown, field: string): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const text = value
    .map((item) => (item && typeof item === "object" && typeof (item as Record<string, unknown>)[field] === "string" ? (item as Record<string, string>)[field] : ""))
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

function outputFromTitan(body: Record<string, unknown>): string {
  if (typeof body.outputText === "string") {
    return body.outputText;
  }
  return joinedTextFromArray(body.results, "outputText") ?? "";
}

function outputFromAnthropic(body: Record<string, unknown>): string {
  return joinedTextFromArray(body.content, "text") ?? "";
}

function outputFromCohere(body: Record<string, unknown>): string {
  if (typeof body.text === "string") {
    return body.text;
  }
  return joinedTextFromArray(body.generations, "text") ?? "";
}

function outputFromMistral(body: Record<string, unknown>): string {
  return joinedTextFromArray(body.outputs, "text") ?? "";
}

export function extractBedrockOutputText(
  value: unknown,
  options: BedrockAdapterOptions & { modelId?: string } = {}
): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const body = value as Record<string, unknown>;
  const family = options.modelId
    ? bedrockModelFamilyForModelId(options.modelId, { allowGenericJson: options.allowGenericJson })
    : "generic_json";

  if (family === "anthropic_claude_messages") {
    return outputFromAnthropic(body);
  }
  if (family === "amazon_titan_text" || family === "generic_json") {
    return outputFromTitan(body);
  }
  if (family === "cohere_command" || family === "cohere_command_r") {
    return outputFromCohere(body);
  }
  return outputFromMistral(body);
}
