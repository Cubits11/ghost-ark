import { InMemoryVaultStore, VaultIdentity } from "./store";
import { MemoryRecord } from "./tiers";

export interface DeleteMemoryResult {
  deleted: boolean;
  tombstoned: boolean;
}

export function deleteOrTombstoneMemory(
  store: InMemoryVaultStore,
  request: VaultIdentity & { id: string; now?: string }
): DeleteMemoryResult {
  const record = store.get(request);
  store.deleteErasable(request);
  return {
    deleted: record.tier !== "AUDIT",
    tombstoned: record.tier === "AUDIT"
  };
}

export function exportErasableMemory(store: InMemoryVaultStore, request: VaultIdentity & { now?: string }): MemoryRecord[] {
  return store.exportUserMemory(request);
}
