/**
 * Evidence staleness as a monotone downgrade lattice (temporal-trust, sound form).
 *
 * See docs/research/TEMPORAL_TRUST_MODEL.md for the theory. The short version:
 * "evidentiary half-life" is a metaphor, and modelling it as a continuous
 * probability P(valid | Δt) is unsound — there is no generative model behind the
 * coefficient, it is unfalsifiable, and it breaks reproducibility (the same
 * receipt bytes would score differently tomorrow).
 *
 * The reproducible formalization: a receipt's evidentiary standing is a position
 * on a totally-ordered lattice, and it only ever descends, and only via
 * discrete, provenance-cited events. Freshness is measured in LEDGER POSITION
 * (epoch lag), never wall-clock seconds, so the verdict is a pure function of
 * cited inputs and does not drift with the reader's clock.
 *
 * Non-claim: a standing is a discrete lattice position derived from the supplied
 * events. It is not a probability, a confidence score, or a prediction of
 * reliability. Absence of a downgrade event is not evidence of soundness.
 */

export const evidenceDowngradeReportSchemaVersion =
  "ghost.evidence_downgrade_report.v1" as const;

export type EvidenceStanding =
  | "current"
  | "stale"
  | "policy_superseded"
  | "drift_observed"
  | "key_revoked"
  | "withdrawn";

export type DowngradeKind =
  | "freshness_exceeded"
  | "policy_superseded"
  | "drift_observed"
  | "key_revoked"
  | "withdrawn";

// Severity order: lower is better. Standing only ever moves to a worse (higher) rank.
const STANDING_RANK: Record<EvidenceStanding, number> = {
  current: 0,
  stale: 1,
  policy_superseded: 2,
  drift_observed: 3,
  key_revoked: 4,
  withdrawn: 5,
};

const KIND_TO_STANDING: Record<DowngradeKind, EvidenceStanding> = {
  freshness_exceeded: "stale",
  policy_superseded: "policy_superseded",
  drift_observed: "drift_observed",
  key_revoked: "key_revoked",
  withdrawn: "withdrawn",
};

export interface DowngradeEvent {
  kind: DowngradeKind;
  /** Human-readable reason. */
  reason: string;
  /** Provenance citation: ledger index, CloudTrail id, policy version, etc. */
  source: string;
  /** Ledger position at which the event was recorded (append-only order). */
  ledgerIndex?: number;
}

export interface FreshnessPolicy {
  /** Maximum permitted lag, in ledger epochs, before a receipt is `stale`. */
  maxEpochLag: number;
  /** Ledger index the receipt was committed at. */
  inclusionEpochIndex: number;
  /** Ledger index the evaluation is anchored to. */
  evaluationEpochIndex: number;
}

export interface AppliedDowngrade {
  from: EvidenceStanding;
  to: EvidenceStanding;
  kind: DowngradeKind;
  reason: string;
  source: string;
  ledger_index: number | null;
}

export interface EvidenceStandingReport {
  schema_version: typeof evidenceDowngradeReportSchemaVersion;
  receipt_id: string;
  standing: EvidenceStanding;
  applied_downgrades: AppliedDowngrade[];
  non_claims: string[];
}

const NON_CLAIMS = [
  "Standing is a discrete lattice position derived from cited downgrade events. It is not a probability, confidence score, or predicted reliability.",
  "Freshness is measured in ledger-epoch lag, not wall-clock time, so the verdict does not drift with the reader's clock.",
  "Absence of a downgrade event is not evidence that the underlying decision was sound.",
];

function worse(a: EvidenceStanding, b: EvidenceStanding): EvidenceStanding {
  return STANDING_RANK[a] >= STANDING_RANK[b] ? a : b;
}

/**
 * Deterministically evaluate a receipt's evidentiary standing. Events are sorted
 * by (severity, kind, source) before application so the output is stable
 * regardless of input order; only strict downgrades are recorded in the trail.
 */
export function evaluateEvidenceStanding(input: {
  receiptId: string;
  events?: DowngradeEvent[];
  freshness?: FreshnessPolicy;
}): EvidenceStandingReport {
  if (typeof input.receiptId !== "string" || input.receiptId.length === 0) {
    throw new Error("receiptId must be a non-empty string");
  }

  const events: DowngradeEvent[] = [...(input.events ?? [])];

  if (input.freshness) {
    const { maxEpochLag, inclusionEpochIndex, evaluationEpochIndex } = input.freshness;
    if (
      !Number.isSafeInteger(maxEpochLag) ||
      maxEpochLag < 0 ||
      !Number.isSafeInteger(inclusionEpochIndex) ||
      !Number.isSafeInteger(evaluationEpochIndex)
    ) {
      throw new Error("Freshness policy requires non-negative safe-integer epoch indices");
    }
    if (evaluationEpochIndex < inclusionEpochIndex) {
      throw new Error("evaluationEpochIndex cannot precede inclusionEpochIndex");
    }
    const lag = evaluationEpochIndex - inclusionEpochIndex;
    if (lag > maxEpochLag) {
      events.push({
        kind: "freshness_exceeded",
        reason: `Ledger-epoch lag ${lag} exceeds the freshness window of ${maxEpochLag}.`,
        source: `ledger:${inclusionEpochIndex}->${evaluationEpochIndex}`,
        ledgerIndex: evaluationEpochIndex,
      });
    }
  }

  for (const event of events) {
    if (!(event.kind in KIND_TO_STANDING)) {
      throw new Error(`Unsupported downgrade kind: ${String(event.kind)}`);
    }
    if (typeof event.reason !== "string" || event.reason.length === 0) {
      throw new Error("Every downgrade event requires a reason");
    }
    if (typeof event.source !== "string" || event.source.length === 0) {
      throw new Error("Every downgrade event requires a provenance source");
    }
  }

  const ordered = [...events].sort((a, b) => {
    const rankDelta = STANDING_RANK[KIND_TO_STANDING[a.kind]] - STANDING_RANK[KIND_TO_STANDING[b.kind]];
    if (rankDelta !== 0) return rankDelta;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });

  let standing: EvidenceStanding = "current";
  const applied: AppliedDowngrade[] = [];
  for (const event of ordered) {
    const target = KIND_TO_STANDING[event.kind];
    const next = worse(standing, target);
    if (STANDING_RANK[next] > STANDING_RANK[standing]) {
      applied.push({
        from: standing,
        to: next,
        kind: event.kind,
        reason: event.reason,
        source: event.source,
        ledger_index: event.ledgerIndex ?? null,
      });
      standing = next;
    }
  }

  return {
    schema_version: evidenceDowngradeReportSchemaVersion,
    receipt_id: input.receiptId,
    standing,
    applied_downgrades: applied,
    non_claims: NON_CLAIMS,
  };
}
