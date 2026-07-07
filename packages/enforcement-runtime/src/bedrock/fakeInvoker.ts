import { publicSha256Digest } from "../receipts/canonical";
import { ModelInvokeInput, ModelInvokeOutput, ModelInvoker } from "./types";

export class FakeModelInvoker implements ModelInvoker {
  readonly calls: ModelInvokeInput[] = [];
  outputText: string;
  error?: Error;

  constructor(options: { outputText?: string; error?: Error } = {}) {
    this.outputText = options.outputText ?? "fake model output";
    this.error = options.error;
  }

  get called(): boolean {
    return this.calls.length > 0;
  }

  async invoke(input: ModelInvokeInput): Promise<ModelInvokeOutput> {
    this.calls.push(input);
    if (this.error) {
      throw this.error;
    }
    return {
      outputText: this.outputText,
      rawOutputDigest: publicSha256Digest(this.outputText),
      latencyMs: 1,
      costEstimateUsd: 0
    };
  }
}
