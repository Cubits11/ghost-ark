import { CloudMetricsCollector } from "./cloudMetrics";

export class BigQueryMetricsTracker {
  constructor(private readonly metrics: CloudMetricsCollector) {}

  recordRowIngested(count: number): void {
    this.metrics.recordMetric("bq_rows_ingested", count);
  }

  recordQueryLatency(latencyMs: number): void {
    this.metrics.recordMetric("bq_query_latency_ms", latencyMs);
  }
}
