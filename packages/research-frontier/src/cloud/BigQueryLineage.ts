export interface LineageHop {
  sourceTable: string;
  targetTable: string;
  operation: string;
  timestamp: string;
}

export class BigQueryLineageTracker {
  private readonly hops: LineageHop[] = [];

  recordHop(hop: LineageHop): void {
    this.hops.push(hop);
  }

  getTrace(targetTable: string): LineageHop[] {
    return this.hops.filter((h) => h.targetTable === targetTable);
  }
}
