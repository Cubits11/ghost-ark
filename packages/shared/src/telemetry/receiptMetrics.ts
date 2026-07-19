import { CloudMetricsCollector } from "./cloudMetrics";

export class ReceiptMetricsTracker {
  constructor(private readonly metrics: CloudMetricsCollector) {}

  recordReceiptIssued(tenantSlug: string): void {
    this.metrics.recordMetric("receipt_issued_total", 1, { tenantSlug });
  }

  recordReceiptVerification(valid: boolean): void {
    this.metrics.recordMetric("receipt_verification_total", 1, { valid: String(valid) });
  }
}
