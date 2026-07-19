import { CloudMetricsCollector } from "./cloudMetrics";

export class StorageMetricsTracker {
  constructor(private readonly metrics: CloudMetricsCollector) {}

  recordStorageDownload(bytes: number): void {
    this.metrics.recordMetric("gcs_download_bytes", bytes);
  }
}
