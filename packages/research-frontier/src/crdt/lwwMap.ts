// LWW-Map (Last-Write-Wins Map) CRDT Engine
//
// CLAIM BOUNDARY: This module implements a State-Based Conflict-Free Replicated Data Type (CvRDT).
// It explicitly resolves to EVENTUAL CONSISTENCY, NOT strong consistency. By design, concurrent
// writes to the same key are resolved deterministically by clock and Node ID tie-breakers,
// dropping the "losing" write to bypass the swarm starvation trap without distributed locks.
// This is not a Paxos or Raft replacement; it is a conflict-free merge strategy for non-deterministic
// agent speculation.
//
// No maturity annotation: pure computation over supplied state, no network assumptions beyond eventual delivery.

import { createHash } from "node:crypto";

export type Provenance = "GATEWAY_RECORDED" | "AGENT_ASSERTED";

export interface LWWRegister {
  readonly value: string;
  readonly clock: number;
  readonly nodeId: string;
  readonly provenance: Provenance;
}

export class LWWMap {
  private readonly state = new Map<string, LWWRegister>();
  private localClock = 0;
  
  constructor(public readonly nodeId: string) {}

  public get(key: string): string | undefined {
    return this.state.get(key)?.value;
  }

  public getClock(): number {
    return this.localClock;
  }

  public getState(): Map<string, LWWRegister> {
    return new Map(this.state);
  }

  // Generate an intent for a local write
  public createWriteIntent(key: string, value: string, provenance: Provenance): LWWRegister {
    this.localClock += 1;
    return {
      value,
      clock: this.localClock,
      nodeId: this.nodeId,
      provenance,
    };
  }

  // Apply a remote or local operation
  // Returns true if the state was mutated (the write won)
  public apply(key: string, incoming: LWWRegister): boolean {
    this.localClock = Math.max(this.localClock, incoming.clock);
    const existing = this.state.get(key);
    
    if (existing) {
      if (incoming.clock < existing.clock) {
        return false;
      }
      if (incoming.clock === existing.clock && incoming.nodeId <= existing.nodeId) {
        return false;
      }
    }
    
    this.state.set(key, incoming);
    return true;
  }

  // Merge another state completely
  public merge(remoteState: Map<string, LWWRegister>): void {
    for (const [key, reg] of remoteState.entries()) {
      this.apply(key, reg);
    }
  }

  // Compute the exact SHA-256 state root for cryptographic witness
  public computeStateRoot(): string {
    const keys = Array.from(this.state.keys()).sort();
    const hash = createHash("sha256");
    for (const k of keys) {
      const reg = this.state.get(k)!;
      hash.update(`${k}:${reg.value}:${reg.clock}:${reg.nodeId}:${reg.provenance};`);
    }
    return `sha256:${hash.digest("hex")}`;
  }
}
