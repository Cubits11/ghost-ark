export interface RegionState {
  regionName: string;
  headEpoch: string;
  receiptCount: number;
}

export class MultiRegionLedgerCoordinator {
  private readonly regions = new Map<string, RegionState>();

  updateRegion(state: RegionState): void {
    this.regions.set(state.regionName, state);
  }

  isRegionInSync(regionA: string, regionB: string): boolean {
    const a = this.regions.get(regionA);
    const b = this.regions.get(regionB);
    if (!a || !b) return false;
    return a.headEpoch === b.headEpoch && a.receiptCount === b.receiptCount;
  }
}
