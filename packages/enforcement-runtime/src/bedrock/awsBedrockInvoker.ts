import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { publicSha256Digest } from "../receipts/canonical";
import { buildBedrockRequestBody, extractBedrockOutputText } from "./adapter";
import { ModelInvokeInput, ModelInvokeOutput, ModelInvoker } from "./types";

export interface AwsBedrockInvokerOptions {
  client?: BedrockRuntimeClient;
  guardrailId?: string;
  guardrailVersion?: string;
  allowGenericJsonAdapter?: boolean;
}

export class AwsBedrockInvoker implements ModelInvoker {
  private readonly client: BedrockRuntimeClient;
  private readonly guardrailId?: string;
  private readonly guardrailVersion?: string;
  private readonly allowGenericJsonAdapter: boolean;

  constructor(options: AwsBedrockInvokerOptions = {}) {
    this.client = options.client ?? new BedrockRuntimeClient({});
    this.guardrailId = options.guardrailId;
    this.guardrailVersion = options.guardrailVersion;
    this.allowGenericJsonAdapter = options.allowGenericJsonAdapter ?? false;
  }

  async invoke(input: ModelInvokeInput): Promise<ModelInvokeOutput> {
    const started = Date.now();
    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: input.modelId,
        contentType: "application/json",
        accept: "application/json",
        ...(this.guardrailId && this.guardrailVersion
          ? {
              guardrailIdentifier: this.guardrailId,
              guardrailVersion: this.guardrailVersion
            }
          : {}),
        body: Buffer.from(
          JSON.stringify(
            buildBedrockRequestBody({
              modelId: input.modelId,
              prompt: input.prompt,
              temperature: input.temperature,
              maxTokens: input.maxTokens,
              allowGenericJson: this.allowGenericJsonAdapter
            })
          )
        )
      })
    );

    const decoded = response.body ? JSON.parse(Buffer.from(response.body).toString("utf8")) : {};
    const outputText = extractBedrockOutputText(decoded, {
      modelId: input.modelId,
      allowGenericJson: this.allowGenericJsonAdapter
    });
    return {
      outputText,
      rawOutputDigest: publicSha256Digest(outputText),
      latencyMs: Math.max(0, Date.now() - started),
      metadata: {
        guardrailConfigured: Boolean(this.guardrailId && this.guardrailVersion)
      }
    };
  }
}
