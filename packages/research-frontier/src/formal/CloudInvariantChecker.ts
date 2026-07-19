export interface CloudStateSnapshot {
  storageReceiptIds: string[];
  bigQueryReceiptIds: string[];
}

export function verifyPublicationInvariants(snapshot: CloudStateSnapshot): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const storageSet = new Set(snapshot.storageReceiptIds);

  for (const bqId of snapshot.bigQueryReceiptIds) {
    if (!storageSet.has(bqId)) {
      violations.push(`Orphan BigQuery receipt row without storage object: ${bqId}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}
