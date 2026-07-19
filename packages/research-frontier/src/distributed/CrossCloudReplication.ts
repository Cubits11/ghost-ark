export interface CloudReplicaStatus {
  cloudProvider: "aws" | "gcp" | "azure";
  lastSyncedReceiptId: string;
  syncedAt: string;
}

export class CrossCloudReplicationEngine {
  private readonly statuses = new Map<string, CloudReplicaStatus>();

  recordSyncStatus(status: CloudReplicaStatus): void {
    this.statuses.set(status.cloudProvider, status);
  }

  getSyncStatus(cloudProvider: "aws" | "gcp" | "azure"): CloudReplicaStatus | undefined {
    return this.statuses.get(cloudProvider);
  }
}
