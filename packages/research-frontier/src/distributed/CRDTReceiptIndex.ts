export interface IndexEntry {
  receiptId: string;
  timestamp: string;
  tenantSlug: string;
}

export class CRDTReceiptIndex {
  private readonly entries = new Map<string, IndexEntry>();

  addEntry(entry: IndexEntry): void {
    const existing = this.entries.get(entry.receiptId);
    if (!existing || entry.timestamp > existing.timestamp) {
      this.entries.set(entry.receiptId, entry);
    }
  }

  merge(other: CRDTReceiptIndex): void {
    for (const entry of other.entries.values()) {
      this.addEntry(entry);
    }
  }

  getEntries(): IndexEntry[] {
    return Array.from(this.entries.values());
  }
}
