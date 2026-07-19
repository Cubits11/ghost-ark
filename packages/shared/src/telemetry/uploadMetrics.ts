import { CloudMetricsCollector } from "./cloudMetrics";

export class UploadMetricsTracker {
  constructor(private readonly metrics: CloudMetricsCollector) {}

  recordUploadSuccess(sizeBytes: number, durationMs: number): void {
    this.metrics.recordMetric("gcs_upload_bytes", sizeBytes);
    this.metrics.recordMetric("gcs_upload_duration_ms", durationMs);
  }

  recordUploadFailure(errorType: string): void {
    this.metrics.recordMetric("gcs_upload_errors", 1, { errorType });
  }
}
