export class CloudTransparencyLog {
  private readonly log: string[] = [];

  append(entryDigest: string): number {
    this.log.push(entryDigest);
    return this.log.length - 1;
  }

  getEntries(): readonly string[] {
    return this.log;
  }

  getHeadHash(): string {
    if (this.log.length === 0) return "";
    return this.log[this.log.length - 1];
  }
}
