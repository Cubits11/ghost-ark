export const GOVERNED_INVOKE_METRIC_NAMESPACE = "GhostArk/GovernedInvoke";

export const governedInvokeMetricNames = [
  "GovernedInvokeCompleted",
  "GovernedInvokeFailedClosed",
  "GovernedInvokeReceiptEmissionFailed",
  "GovernedInvokePolicyLoadFailed",
  "GovernedInvokeKmsSigningFailed",
  "GovernedInvokeCrossTenantRetrievalBlocked",
  "GovernedInvokeBedrockFailed",
  "GovernedInvokeMemorySuppressed"
] as const;

export type GovernedInvokeMetricName = (typeof governedInvokeMetricNames)[number];

export interface GovernedInvokeMetricDimensions {
  stage: string;
  status: string;
  modelId?: string;
}

export interface GovernedInvokeMetric {
  name: GovernedInvokeMetricName;
  value?: number;
  dimensions: GovernedInvokeMetricDimensions;
}

export interface GovernedInvokeMetrics {
  emit(metric: GovernedInvokeMetric): void | Promise<void>;
}

export function normalizeModelIdForMetric(modelId: string | undefined): string | undefined {
  if (!modelId) {
    return undefined;
  }
  return modelId.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 128);
}

export class EmfGovernedInvokeMetrics implements GovernedInvokeMetrics {
  emit(metric: GovernedInvokeMetric): void {
    const dimensions = {
      stage: metric.dimensions.stage,
      status: metric.dimensions.status,
      ...(metric.dimensions.modelId ? { modelId: normalizeModelIdForMetric(metric.dimensions.modelId) } : {})
    };
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: GOVERNED_INVOKE_METRIC_NAMESPACE,
              Dimensions: [Object.keys(dimensions)],
              Metrics: [{ Name: metric.name, Unit: "Count" }]
            }
          ]
        },
        ...dimensions,
        [metric.name]: metric.value ?? 1
      })
    );
  }
}
