export interface ModelInvokeInput {
  modelId: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  requestId: string;
}

export interface ModelInvokeOutput {
  outputText: string;
  rawOutputDigest: string;
  latencyMs: number;
  costEstimateUsd?: number;
}

export interface ModelInvoker {
  invoke(input: ModelInvokeInput): Promise<ModelInvokeOutput>;
}
