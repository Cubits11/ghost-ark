import { createHash } from "crypto";
import { canonicalize } from "../../../receipt-schema/src/hashCanonicalization";
import {
  EvidenceFloorRequirement,
  ProvenanceLabeledEvidence,
  evaluateEvidenceFloor
} from "../../../enforcement-runtime/src/evidence/provenanceLattice";
import { ValidationError } from "../../../shared/src/errors";

/**
 * Research-only reference implementation of speculative-collapse semantics
 * (docs/research/PHASE_V_LATENCY_BENCHMARK.md; model: proofs/tla/SpeculativeCollapse.tla).
 *
 * A fork produces a draft the speculative thread may mutate freely. The
 * collapse rule is mechanical: commitSpeculation applies the draft to the
 * canonical state only when the supplied evidence — labeled by the boundary,
 * never by the agent — satisfies the requirement floor. A refused collapse
 * aborts the speculation entirely (fail closed), and abort markers carry a
 * digest of the discarded draft, never its content, so pruned trajectories do
 * not leak back through the marker channel.
 *
 * Claim boundary: this manages in-process JSON state under collapse
 * semantics. It provides no memory isolation, no process isolation, and is
 * not a CRIU or microVM snapshot mechanism.
 */

export interface SpeculationCommit {
  committed: true;
  dirtyKeys: string[];
  evaluationDetail: string;
}

export interface SpeculationAbortMarker {
  aborted: true;
  draftDigest: string;
  effectClass: string;
}

function forkerError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.speculative_context.v1", ...context });
}

function canonicalClone(value: Record<string, unknown>, field: string): Record<string, unknown> {
  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch (error) {
    throw forkerError(`${field} must be a plain JSON-serializable object.`, {
      field,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const parsed = JSON.parse(canonical) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw forkerError(`${field} must be a JSON object.`, { field });
  }
  return parsed as Record<string, unknown>;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class SpeculativeContextManager {
  private base: Record<string, unknown>;
  private draft: Record<string, unknown> | null = null;
  private readonly markers: SpeculationAbortMarker[] = [];

  constructor(context: Record<string, unknown>) {
    this.base = canonicalClone(context, "context");
  }

  /** One speculation at a time; nested forks are refused. */
  fork(): Record<string, unknown> {
    if (this.draft !== null) {
      throw forkerError("A speculation is already active; nested forks are refused.");
    }
    this.draft = canonicalClone(this.base, "context");
    return this.draft;
  }

  private dirtyKeysBetween(base: Record<string, unknown>, draft: Record<string, unknown>): string[] {
    const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
    const dirty: string[] = [];
    for (const key of keys) {
      const inBase = key in base;
      const inDraft = key in draft;
      if (inBase !== inDraft) {
        dirty.push(key);
        continue;
      }
      if (canonicalize(base[key]) !== canonicalize(draft[key])) {
        dirty.push(key);
      }
    }
    return dirty.sort();
  }

  /**
   * Collapse rule. The draft reaches canonical state only when the evidence
   * satisfies the floor. On refusal the speculation is discarded (fail
   * closed) and an abort marker is recorded before the error is thrown.
   */
  commitSpeculation(
    evidence: ProvenanceLabeledEvidence[],
    requirement: EvidenceFloorRequirement
  ): SpeculationCommit {
    if (this.draft === null) {
      throw forkerError("No active speculation to commit.");
    }
    const draft = canonicalClone(this.draft, "draft");
    const evaluation = evaluateEvidenceFloor(evidence, requirement);

    if (!evaluation.satisfied) {
      this.recordAbort(draft, requirement.effectClass);
      throw forkerError(`Collapse refused: ${evaluation.detail}`, {
        effectClass: requirement.effectClass
      });
    }

    const dirtyKeys = this.dirtyKeysBetween(this.base, draft);
    this.base = draft;
    this.draft = null;
    return { committed: true, dirtyKeys, evaluationDetail: evaluation.detail };
  }

  abortSpeculation(effectClass: string): SpeculationAbortMarker {
    if (this.draft === null) {
      throw forkerError("No active speculation to abort.");
    }
    const draft = canonicalClone(this.draft, "draft");
    return this.recordAbort(draft, effectClass);
  }

  private recordAbort(draft: Record<string, unknown>, effectClass: string): SpeculationAbortMarker {
    const marker: SpeculationAbortMarker = {
      aborted: true,
      draftDigest: `sha256:${sha256Hex(canonicalize(draft))}`,
      effectClass
    };
    this.markers.push(marker);
    this.draft = null;
    return marker;
  }

  /** Canonical clone of the current base state, for assertions and severance checks. */
  snapshot(): Record<string, unknown> {
    return canonicalClone(this.base, "context");
  }

  abortMarkers(): readonly SpeculationAbortMarker[] {
    return [...this.markers];
  }
}
