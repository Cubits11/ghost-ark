export interface MetricEvent {
  metricName: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: string;
}

export class CloudMetricsCollector {
  private readonly events: MetricEvent[] = [];

  recordMetric(metricName: string, value: number, tags?: Record<string, string>): void {
    this.events.push({
      metricName,
      value,
      tags,
      timestamp: new Date().toISOString()
    });
  }

  getEvents(): readonly MetricEvent[] {
    return this.events;
  }
}
