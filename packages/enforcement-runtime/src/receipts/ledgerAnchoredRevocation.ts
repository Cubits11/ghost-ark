import { ValidationError } from "../../../shared/src/errors";
import {
  type MerkleInclusionProof,
  verifyMerkleInclusionProof,
} from "./checkpoint";

/**
 * Ledger-anchored revocation (temporal-trust primitive).
 *
 * Problem this addresses:
 *   The v1 key-manifest epoch check evaluates revocation against the
 *   signer-asserted `receipt.timestamp`. A holder of a since-revoked key can
 *   mint a fresh receipt, stamp a timestamp earlier than `revokedAt`, and pass
 *   the epoch check. The timestamp is the one input the forger controls.
 *
 * The fix:
 *   Replace the *duration* claim ("this was signed before revocation") with an
 *   *order* claim the signer cannot set: a receipt is pre-revocation iff its
 *   chain-head leaf is included in an append-only checkpoint whose ledger index
 *   is strictly less than the index of the checkpoint that recorded the
 *   revocation. Inclusion position is assigned by the log, not the signer.
 *
 * This module NEVER consumes `receipt.timestamp` for the decision. It accepts it
 * only to *detect* backdating: a self-reported time that claims "before
 * revocation" while the ledger order says otherwise is affirmative evidence of
 * an attempted backdating attack.
 *
 * Non-claim: a `valid_pre_revocation` verdict binds revocation to ledger order
 * under the supplied sequence. It does not prove key custody, semantic
 * correctness, or that the ledger itself is independently witnessed. It is only
 * as strong as the append-only property of the checkpoint sequence it is given.
 */

export const ledgerAnchoredRevocationSchemaVersion =
  "ghost.ledger_anchored_revocation.v1" as const;

export interface LedgerEpochRef {
  /** Stable identifier of the checkpoint epoch. */
  epochId: string;
  /** Monotonic ledger position. Strictly increasing across the sequence. */
  index: number;
  /** Wall-clock stamp of when the epoch was sealed (used only for reporting). */
  createdAt: string;
  /** Merkle root the receipt's inclusion proof must reconstruct. */
  merkleRoot: string;
}

export interface LedgerSequence {
  logId: string;
  epochs: LedgerEpochRef[];
}

export interface RevocationAnchor {
  /** Key whose revocation is being enforced. */
  keyId: string;
  /** Epoch in which the revocation was published to the append-only ledger. */
  revocationEpochId: string;
  reason?: string;
}

export interface LedgerAnchoredRevocationInput {
  /** Key that signed the receipt under evaluation. */
  keyId: string;
  /**
   * Signer-asserted timestamp. Used ONLY to detect backdating — never to
   * decide the verdict. Omit it and the decision is identical.
   */
  receiptTimestamp?: string;
  /** Epoch checkpoint the receipt's chain-head leaf is included in. */
  inclusionEpochId: string;
  /** Proof binding the receipt's chain-head leaf to the inclusion epoch root. */
  inclusionProof: MerkleInclusionProof;
  sequence: LedgerSequence;
  revocation: RevocationAnchor;
}

export interface LedgerAnchoredCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export type LedgerAnchoredStanding =
  | "valid_pre_revocation"
  | "rejected_post_revocation"
  | "rejected_unprovable";

export interface LedgerAnchoredRevocationResult {
  schemaVersion: typeof ledgerAnchoredRevocationSchemaVersion;
  verdict: boolean;
  standing: LedgerAnchoredStanding;
  inclusionIndex: number | null;
  revocationIndex: number | null;
  /**
   * Positive-only signal. `true` means a clock-vs-ledger contradiction was
   * observed; `false` asserts nothing (absence of evidence, not evidence of
   * absence). It never affects the verdict, which is decided by ledger order.
   */
  backdatingSuspected: boolean;
  checks: LedgerAnchoredCheck[];
  detail: string;
  nonClaim: string;
}

const NON_CLAIM =
  "Binds revocation to append-only ledger position, not to the signer-asserted timestamp. " +
  "Does not prove key custody, semantic correctness, or independent witnessing of the ledger.";

/**
 * Validate that a sequence is a well-formed append-only ledger: single log,
 * strictly increasing indices, strictly increasing seal times, unique epochIds,
 * and sha256 roots. Rejects (throws) rather than silently tolerating a
 * non-monotone sequence, because monotonicity is exactly the property the
 * ordering argument depends on.
 */
export function assertMonotonicLedgerSequence(sequence: LedgerSequence): void {
  if (!sequence || typeof sequence.logId !== "string" || sequence.logId.length === 0) {
    throw new ValidationError("Ledger sequence requires a non-empty logId", {
      domain: ledgerAnchoredRevocationSchemaVersion,
    });
  }
  if (!Array.isArray(sequence.epochs) || sequence.epochs.length === 0) {
    throw new ValidationError("Ledger sequence requires at least one epoch", {
      domain: ledgerAnchoredRevocationSchemaVersion,
    });
  }

  const seenIds = new Set<string>();
  let previous: LedgerEpochRef | null = null;
  for (const epoch of sequence.epochs) {
    if (!Number.isSafeInteger(epoch.index) || epoch.index < 0) {
      throw new ValidationError("Epoch index must be a non-negative safe integer", {
        domain: ledgerAnchoredRevocationSchemaVersion,
        epochId: epoch.epochId,
      });
    }
    // Must be the `sha256:`-prefixed form the checkpoint Merkle functions emit;
    // a bare-hex root can never equal a computed root, so accepting it would only
    // convert a real format error into a silent rejected_unprovable.
    if (!/^sha256:[a-f0-9]{64}$/.test(epoch.merkleRoot)) {
      throw new ValidationError("Epoch merkleRoot must be a sha256: -prefixed digest", {
        domain: ledgerAnchoredRevocationSchemaVersion,
        epochId: epoch.epochId,
      });
    }
    if (seenIds.has(epoch.epochId)) {
      throw new ValidationError("Duplicate epochId in ledger sequence", {
        domain: ledgerAnchoredRevocationSchemaVersion,
        epochId: epoch.epochId,
      });
    }
    seenIds.add(epoch.epochId);

    const createdAt = Date.parse(epoch.createdAt);
    if (!Number.isFinite(createdAt)) {
      throw new ValidationError("Epoch createdAt must be a date-time", {
        domain: ledgerAnchoredRevocationSchemaVersion,
        epochId: epoch.epochId,
      });
    }

    if (previous !== null) {
      if (epoch.index <= previous.index) {
        throw new ValidationError("Ledger epoch indices must strictly increase", {
          domain: ledgerAnchoredRevocationSchemaVersion,
          epochId: epoch.epochId,
        });
      }
      if (createdAt <= Date.parse(previous.createdAt)) {
        throw new ValidationError("Ledger epoch createdAt must strictly increase", {
          domain: ledgerAnchoredRevocationSchemaVersion,
          epochId: epoch.epochId,
        });
      }
    }
    previous = epoch;
  }
}

function findEpoch(sequence: LedgerSequence, epochId: string): LedgerEpochRef | null {
  return sequence.epochs.find((epoch) => epoch.epochId === epochId) ?? null;
}

function reject(
  standing: LedgerAnchoredStanding,
  detail: string,
  checks: LedgerAnchoredCheck[],
  extra: Partial<LedgerAnchoredRevocationResult> = {},
): LedgerAnchoredRevocationResult {
  return {
    schemaVersion: ledgerAnchoredRevocationSchemaVersion,
    verdict: false,
    standing,
    inclusionIndex: null,
    revocationIndex: null,
    backdatingSuspected: false,
    checks,
    detail,
    nonClaim: NON_CLAIM,
    ...extra,
  };
}

/**
 * Enforce revocation by ledger order. Fails closed: if the receipt's ledger
 * position cannot be located and proven, or the revocation epoch is unknown,
 * the result is `rejected_unprovable` rather than a permissive pass.
 */
export function enforceLedgerAnchoredRevocation(
  input: LedgerAnchoredRevocationInput,
): LedgerAnchoredRevocationResult {
  const checks: LedgerAnchoredCheck[] = [];

  try {
    assertMonotonicLedgerSequence(input.sequence);
    checks.push({ name: "ledger_monotonic", passed: true, detail: "Ledger sequence is append-only and strictly ordered." });
  } catch (error) {
    return reject("rejected_unprovable", "Ledger sequence is not a valid append-only order.", [
      { name: "ledger_monotonic", passed: false, detail: error instanceof Error ? error.message : String(error) },
    ]);
  }

  if (input.keyId !== input.revocation.keyId) {
    checks.push({ name: "key_scope", passed: false, detail: `Revocation anchor targets ${input.revocation.keyId}, not the signing key ${input.keyId}.` });
    return reject("rejected_unprovable", "Revocation anchor does not apply to the signing key.", checks);
  }
  checks.push({ name: "key_scope", passed: true, detail: `Revocation anchor applies to signing key ${input.keyId}.` });

  const inclusionEpoch = findEpoch(input.sequence, input.inclusionEpochId);
  if (inclusionEpoch === null) {
    checks.push({ name: "inclusion_epoch_located", passed: false, detail: `Inclusion epoch ${input.inclusionEpochId} is not in the ledger sequence.` });
    return reject("rejected_unprovable", "Cannot locate the receipt's ledger position.", checks);
  }
  checks.push({ name: "inclusion_epoch_located", passed: true, detail: `Receipt is claimed at ledger index ${inclusionEpoch.index}.` });

  const inclusionValid = verifyMerkleInclusionProof(input.inclusionProof, inclusionEpoch.merkleRoot);
  if (!inclusionValid) {
    checks.push({ name: "inclusion_proof", passed: false, detail: "Inclusion proof does not reconstruct the inclusion epoch root." });
    return reject("rejected_unprovable", "Inclusion proof is invalid; ledger position is unproven.", checks, { inclusionIndex: inclusionEpoch.index });
  }
  checks.push({ name: "inclusion_proof", passed: true, detail: "Inclusion proof reconstructs the inclusion epoch root." });

  const revocationEpoch = findEpoch(input.sequence, input.revocation.revocationEpochId);
  if (revocationEpoch === null) {
    checks.push({ name: "revocation_epoch_located", passed: false, detail: `Revocation epoch ${input.revocation.revocationEpochId} is not in the ledger sequence.` });
    return reject("rejected_unprovable", "Cannot order the receipt against an unknown revocation epoch.", checks, { inclusionIndex: inclusionEpoch.index });
  }
  checks.push({ name: "revocation_epoch_located", passed: true, detail: `Revocation recorded at ledger index ${revocationEpoch.index}.` });

  // Backdating detection: the signer's clock claims pre-revocation while the
  // ledger order says at/after. This never changes the verdict — it labels the
  // attack.
  let backdatingSuspected = false;
  if (typeof input.receiptTimestamp === "string") {
    const claimed = Date.parse(input.receiptTimestamp);
    const revocationSealed = Date.parse(revocationEpoch.createdAt);
    if (
      Number.isFinite(claimed) &&
      Number.isFinite(revocationSealed) &&
      claimed < revocationSealed &&
      inclusionEpoch.index >= revocationEpoch.index
    ) {
      backdatingSuspected = true;
      checks.push({
        name: "backdating_detector",
        passed: false,
        detail: `Self-reported timestamp ${input.receiptTimestamp} claims pre-revocation, but ledger position (${inclusionEpoch.index}) is at or after revocation (${revocationEpoch.index}). Backdating suspected.`,
      });
    } else {
      checks.push({ name: "backdating_detector", passed: true, detail: "No clock-vs-ledger contradiction detected." });
    }
  }

  const pre = inclusionEpoch.index < revocationEpoch.index;
  checks.push({
    name: "ledger_order",
    passed: pre,
    detail: pre
      ? `Inclusion index ${inclusionEpoch.index} precedes revocation index ${revocationEpoch.index}.`
      : `Inclusion index ${inclusionEpoch.index} is at or after revocation index ${revocationEpoch.index}.`,
  });

  return {
    schemaVersion: ledgerAnchoredRevocationSchemaVersion,
    verdict: pre,
    standing: pre ? "valid_pre_revocation" : "rejected_post_revocation",
    inclusionIndex: inclusionEpoch.index,
    revocationIndex: revocationEpoch.index,
    backdatingSuspected,
    checks,
    detail: pre
      ? "Receipt was committed to the ledger before revocation was recorded."
      : "Receipt was committed to the ledger at or after revocation; rejected regardless of its self-reported timestamp.",
    nonClaim: NON_CLAIM,
  };
}
