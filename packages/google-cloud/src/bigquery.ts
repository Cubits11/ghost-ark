import { BigQueryError } from "./errors";
import { BigQueryReceiptRow, bigQueryReceiptRowSchema } from "./schema";
import { withRetry, RetryOptions } from "./retry";

export class MockBigQueryTable {
  private readonly rows: BigQueryReceiptRow[] = [];

  async insertRows(rows: BigQueryReceiptRow[]): Promise<void> {
    for (const row of rows) {
      const parsed = bigQueryReceiptRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new BigQueryError("Invalid BigQuery receipt row", { issues: parsed.error.issues });
      }
      this.rows.push(parsed.data);
    }
  }

  async query(queryStr: string): Promise<BigQueryReceiptRow[]> {
    if (queryStr.toLowerCase().includes("where tenant_slug")) {
      const match = queryStr.match(/tenant_slug\s*=\s*'([^']+)'/i);
      if (match) {
        const slug = match[1];
        return this.rows.filter((r) => r.tenant_slug === slug);
      }
    }
    return [...this.rows];
  }

  getRowCount(): number {
    return this.rows.length;
  }
}

export class BigQueryClient {
  private readonly mockTable?: MockBigQueryTable;

  constructor(useMock = true) {
    if (useMock) {
      this.mockTable = new MockBigQueryTable();
    }
  }

  async insertReceiptRows(rows: BigQueryReceiptRow[], retryOptions?: RetryOptions): Promise<void> {
    return withRetry(async () => {
      if (this.mockTable) {
        return this.mockTable.insertRows(rows);
      }
      throw new BigQueryError("Real BigQuery client uninitialized.");
    }, retryOptions);
  }

  async queryReceipts(querySql: string): Promise<BigQueryReceiptRow[]> {
    if (this.mockTable) {
      return this.mockTable.query(querySql);
    }
    throw new BigQueryError("Real BigQuery client uninitialized.");
  }
}
