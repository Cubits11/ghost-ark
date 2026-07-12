/**
 * Authenticated ledger-anchored revocation.
 *
 * This module is the ordering-safe replacement for the enforcement-runtime
 * `enforceLedgerAnchoredRevocation`, which decides pre/post-revocation standing
 * from a caller-supplied `LedgerSequence` whose epoch roots and indices carry no
 * signatures. That primitive violates the Ledger Design Law:
 *
 *   No production decision may depend on caller-supplied ordering information.
 *
 * The exploit it enables (E1, "fabricated ledger bypass"): a holder of a
 * since-revoked key builds a Merkle tree around its post-revocation chain-head
 * leaf, hands in a sequence whose "inclusion" epoch carries that tree's root at a
 * low index and whose "revocation" epoch sits at a higher index, and supplies the
 * honest inclusion proof for its own leaf. Every check in the unauthenticated
 * path passes and the verdict is `valid_pre_revocation`.
 *
 * The invariant this module restores:
 *
 *   THEOREM (authenticated ordering). A `valid_pre_revocation` verdict is
 *   returned only if the relative order of (receipt leaf, revocation-record leaf)
 *   is fixed by a witness-signed, quorum-verified append-only log whose trust
 *   root (a WitnessKeyManifest) is configured out-of-band, not read from the
 *   receipt. Every root and every leaf position used in the decision is bound by
 *   a witness signature the caller cannot forge without witness keys, or by a
 *   verified Merkle proof against such a root.
 *
 *   COROLLARY (E1 closed). A caller that does not control a witness quorum cannot
 *   fabricate a `valid_pre_revocation` verdict. Fabricated roots fail quorum
 *   verification; fabricated positions fail Merkle inclusion; two unrelated trees
 *   fail the consistency check.
 *
 * Residual assumption (NOT defended here — see ASSUMPTIONS / Phase II): a
 * colluding or equivocating witness quorum that signs a split view of the log can
 * still lie about order. Defeating that requires checkpoint gossip + fork
 * detection + split-view proofs (witnessFraudProof.ts), tracked as
 * A_WITNESS_QUORUM_HONEST.
 *
 * NON-CLAIM: binds revocation to authenticated append-only ledger position under
 * the honest-witness-quorum assumption. Does not prove key custody, semantic
 * correctness of the model output, or that the configured witness set is honest.
 */

import {
  type MerkleConsistencyProof,
  type MerkleInclusionProof,
  verifyConsistencyProof,
  verifyInclusionProof,
} from "./merkle";
import {
  canonicalCheckpointPayload,
  findWitnessKeyManifestEntry,
  validateWitnessKeyManifestSemantics,
  verifyCheckpointSignature,
  verifyWitnessKeyManifestEpoch,
  type WitnessCheckpoint,
  type WitnessKeyManifest,
} from "./witnessCheckpoint";

// --- Maturity / assumption metadata (Phase III/IV convention) --------------

export type Maturity = "PRODUCTION" | "RESEARCH" | "SYNTH_ONLY";

export type AssumptionId =
  | "A_SHA256_COLLISION_RESISTANCE"
  | "A_WITNESS_KEY_MANIFEST_AUTHENTIC"
  | "A_WITNESS_QUORUM_HONEST"
  | "A_APPEND_ONLY_LOG";

/**
 * RESEARCH, not PRODUCTION: the authenticated-ordering *logic* here is sound, but
 * it is only a production trust authority once a live witness deployment with
 * gossip + fork detection exists (Phase II). Until then the witness keys are
 * dev/local and A_WITNESS_QUORUM_HONEST is unverified.
 */
export const MATURITY: Maturity = "RESEARCH";

export const ASSUMPTIONS: AssumptionId[] = [
  "A_SHA256_COLLISION_RESISTANCE",
  "A_WITNESS_KEY_MANIFEST_AUTHENTIC",
  "A_WITNESS_QUORUM_HONEST",
  "A_APPEND_ONLY_LOG",
];

export const authenticatedRevocationSchemaVersion =
  "ghostark.research.authenticated_revocation.v1" as const;

export const ledgerRevocationRecordSchemaVersion =
  "ghostark.research.ledger_revocation_record.v1" as const;

// --- Canonical revocation record -------------------------------------------

/**
 * The revocation record committed to the transparency log. A revocation
 * inclusion proof must address a leaf whose committed payload is exactly the
 * canonical form of one of these records, so a caller cannot point the proof at
 * an unrelated leaf and call it "the revocation".
 */
export interface LedgerRevocationRecord {
  schema_version: typeof ledgerRevocationRecordSchemaVersion;
  type: "key_revocation";
  key_id: string;
  reason?: string;
}

/**
 * Deterministic serialization of a revocation record. Key order is fixed here
 * (not by object insertion order) so the committed-leaf comparison is stable.
 */
export function canonicalRevocationRecordPayload(
  record: LedgerRevocationRecord,
): string {
  if (record.schema_version !== ledgerRevocationRecordSchemaVersion) {
    throw new Error("Revocation record schema_version is unsupported");
  }
  if (record.type !== "key_revocation") {
    throw new Error("Revocation record type must be key_revocation");
  }
  if (typeof record.key_id !== "string" || record.key_id.length === 0) {
    throw new Error("Revocation record key_id must be a non-empty string");
  }
  const canonical: Record<string, unknown> = {
    key_id: record.key_id,
    schema_version: record.schema_version,
    type: record.type,
  };
  if (record.reason !== undefined) {
    canonical.reason = record.reason;
  }
  return JSON.stringify(canonical, Object.keys(canonical).sort());
}

// --- Inputs / outputs ------------------------------------------------------

/** A witness-signed checkpoint together with an inclusion proof into its root. */
export interface CheckpointInclusion {
  checkpoint: WitnessCheckpoint;
  /** Canonical payload of the leaf being proven (receipt payload or revocation record). */
  leafPayload: string;
  proof: MerkleInclusionProof;
}

export interface AuthenticatedRevocationInput {
  /** Signing key under evaluation. */
  keyId: string;
  /**
   * Signer-asserted timestamp. Used ONLY to detect backdating — never to decide
   * the verdict. Omit it and the decision is identical.
   */
  receiptTimestamp?: string;
  /** Trust root: configured out-of-band, NOT derived from the receipt. */
  trustRoot: WitnessKeyManifest;
  /** Minimum number of DISTINCT valid witnesses required per checkpoint. */
  witnessQuorum: number;
  /** Proof that the receipt's chain-head leaf sits at an authenticated position. */
  inclusion: CheckpointInclusion;
  /** Proof that the key's revocation record sits at an authenticated position. */
  revocation: CheckpointInclusion & { keyId: string };
  /**
   * Consistency proof binding the smaller checkpoint's root as a prefix of the
   * larger one. Required whenever the two inclusions use different checkpoints;
   * when they use the same checkpoint, pass a trivial equal-size proof.
   */
  consistency: MerkleConsistencyProof;
}

export type AuthenticatedRevocationStanding =
  | "valid_pre_revocation"
  | "rejected_post_revocation"
  | "rejected_unauthenticated"
  | "rejected_unprovable";

export interface AuthenticatedRevocationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AuthenticatedRevocationResult {
  schemaVersion: typeof authenticatedRevocationSchemaVersion;
  verdict: boolean;
  standing: AuthenticatedRevocationStanding;
  receiptLeafIndex: number | null;
  revocationLeafIndex: number | null;
  /**
   * Positive-only signal. `true` means a clock-vs-ledger contradiction was
   * observed; `false` asserts nothing. It never affects the verdict.
   */
  backdatingSuspected: boolean;
  checks: AuthenticatedRevocationCheck[];
  detail: string;
  nonClaim: string;
}

const NON_CLAIM =
  "Binds revocation to authenticated append-only ledger position under the honest-witness-quorum assumption. " +
  "Does not prove key custody, semantic correctness, or that the configured witness set is honest.";

function reject(
  standing: AuthenticatedRevocationStanding,
  detail: string,
  checks: AuthenticatedRevocationCheck[],
  extra: Partial<AuthenticatedRevocationResult> = {},
): AuthenticatedRevocationResult {
  return {
    schemaVersion: authenticatedRevocationSchemaVersion,
    verdict: false,
    standing,
    receiptLeafIndex: null,
    revocationLeafIndex: null,
    backdatingSuspected: false,
    checks,
    detail,
    nonClaim: NON_CLAIM,
    ...extra,
  };
}

/**
 * Count DISTINCT witness_ids whose signature over the checkpoint's canonical
 * payload verifies AND whose manifest epoch is valid at the checkpoint's
 * integrated_time. Duplicated witness_ids cannot inflate the count.
 */
export function countQuorumWitnesses(
  checkpoint: WitnessCheckpoint,
  manifest: WitnessKeyManifest,
): number {
  const payload = canonicalCheckpointPayload({
    schema_version: checkpoint.schema_version,
    log_id: checkpoint.log_id,
    tree_size: checkpoint.tree_size,
    root_hash: checkpoint.root_hash,
    integrated_time: checkpoint.integrated_time,
  });

  const valid = new Set<string>();
  for (const signature of checkpoint.witness_signatures) {
    const epoch = verifyWitnessKeyManifestEpoch({
      manifest,
      witnessId: signature.witness_id,
      signatureAlgorithm: signature.signature_algorithm,
      integratedTime: checkpoint.integrated_time,
    });
    if (!epoch.passed) {
      continue;
    }
    const entry = findWitnessKeyManifestEntry(
      manifest,
      signature.witness_id,
      signature.signature_algorithm,
    );
    if (
      entry !== null &&
      verifyCheckpointSignature({
        payload,
        signature: signature.signature,
        publicKeyPem: entry.public_key_pem,
      })
    ) {
      valid.add(signature.witness_id);
    }
  }
  return valid.size;
}

/**
 * Enforce revocation by AUTHENTICATED ledger order. Fails closed on any missing
 * or invalid authentication: an unproven position, a sub-quorum checkpoint, a
 * cross-log pair, or a broken consistency relation yields a rejection, never a
 * permissive pass.
 */
export function enforceAuthenticatedLedgerRevocation(
  input: AuthenticatedRevocationInput,
): AuthenticatedRevocationResult {
  const checks: AuthenticatedRevocationCheck[] = [];

  // 0. Trust root must be a well-formed manifest, and quorum a positive integer.
  try {
    validateWitnessKeyManifestSemantics(input.trustRoot);
  } catch (error) {
    return reject("rejected_unauthenticated", "Trust root witness key manifest is invalid.", [
      { name: "trust_root", passed: false, detail: error instanceof Error ? error.message : String(error) },
    ]);
  }
  if (!Number.isSafeInteger(input.witnessQuorum) || input.witnessQuorum < 1) {
    return reject("rejected_unauthenticated", "Witness quorum must be a positive integer.", [
      { name: "quorum_configured", passed: false, detail: `Invalid witnessQuorum ${String(input.witnessQuorum)}.` },
    ]);
  }
  checks.push({ name: "trust_root", passed: true, detail: "Trust root manifest is well-formed." });

  // 1. Key scope: the revocation record must target the signing key.
  if (input.keyId !== input.revocation.keyId) {
    checks.push({ name: "key_scope", passed: false, detail: `Revocation targets ${input.revocation.keyId}, not signing key ${input.keyId}.` });
    return reject("rejected_unprovable", "Revocation record does not apply to the signing key.", checks);
  }
  checks.push({ name: "key_scope", passed: true, detail: `Revocation record applies to signing key ${input.keyId}.` });

  const inclusionCp = input.inclusion.checkpoint;
  const revocationCp = input.revocation.checkpoint;

  // 2. Same append-only log.
  if (inclusionCp.log_id !== revocationCp.log_id) {
    checks.push({ name: "same_log", passed: false, detail: `Inclusion log ${inclusionCp.log_id} != revocation log ${revocationCp.log_id}.` });
    return reject("rejected_unauthenticated", "Checkpoints belong to different logs; order is undefined.", checks);
  }
  checks.push({ name: "same_log", passed: true, detail: `Both checkpoints are for log ${inclusionCp.log_id}.` });

  // 3. Witness quorum on BOTH checkpoints under the configured trust root.
  const inclusionWitnesses = countQuorumWitnesses(inclusionCp, input.trustRoot);
  const revocationWitnesses = countQuorumWitnesses(revocationCp, input.trustRoot);
  if (inclusionWitnesses < input.witnessQuorum || revocationWitnesses < input.witnessQuorum) {
    checks.push({
      name: "witness_quorum",
      passed: false,
      detail: `Quorum ${input.witnessQuorum} not met: inclusion has ${inclusionWitnesses}, revocation has ${revocationWitnesses} distinct valid witnesses.`,
    });
    return reject("rejected_unauthenticated", "Checkpoint witness quorum not met; roots are not authenticated.", checks);
  }
  checks.push({
    name: "witness_quorum",
    passed: true,
    detail: `Both checkpoints meet quorum ${input.witnessQuorum} (inclusion ${inclusionWitnesses}, revocation ${revocationWitnesses}).`,
  });

  // 4. Receipt inclusion proof against the (now authenticated) inclusion root.
  const receiptIncluded =
    input.inclusion.proof.root_hash === inclusionCp.root_hash &&
    verifyInclusionProof({
      payload: input.inclusion.leafPayload,
      proof: input.inclusion.proof,
      expectedRoot: inclusionCp.root_hash,
    });
  if (!receiptIncluded) {
    checks.push({ name: "receipt_inclusion", passed: false, detail: "Receipt leaf inclusion proof does not reconstruct the authenticated inclusion root." });
    return reject("rejected_unprovable", "Receipt ledger position is unproven.", checks);
  }
  const receiptLeafIndex = input.inclusion.proof.leaf_index;
  checks.push({ name: "receipt_inclusion", passed: true, detail: `Receipt leaf is authenticated at index ${receiptLeafIndex}.` });

  // 5. Revocation inclusion proof, AND the committed leaf must be the canonical
  //    revocation record for this key.
  const expectedRevocationPayload = canonicalRevocationRecordPayload({
    schema_version: ledgerRevocationRecordSchemaVersion,
    type: "key_revocation",
    key_id: input.keyId,
    ...(revocationRecordReason(input.revocation.leafPayload) !== undefined
      ? { reason: revocationRecordReason(input.revocation.leafPayload) }
      : {}),
  });
  if (input.revocation.leafPayload !== expectedRevocationPayload) {
    checks.push({ name: "revocation_record_shape", passed: false, detail: "Revocation leaf payload is not the canonical key_revocation record for this key." });
    return reject("rejected_unprovable", "Revocation leaf is not a well-formed revocation record for the signing key.", checks, { receiptLeafIndex });
  }
  const revocationIncluded =
    input.revocation.proof.root_hash === revocationCp.root_hash &&
    verifyInclusionProof({
      payload: input.revocation.leafPayload,
      proof: input.revocation.proof,
      expectedRoot: revocationCp.root_hash,
    });
  if (!revocationIncluded) {
    checks.push({ name: "revocation_inclusion", passed: false, detail: "Revocation leaf inclusion proof does not reconstruct the authenticated revocation root." });
    return reject("rejected_unprovable", "Revocation ledger position is unproven.", checks, { receiptLeafIndex });
  }
  const revocationLeafIndex = input.revocation.proof.leaf_index;
  checks.push({ name: "revocation_inclusion", passed: true, detail: `Revocation record is authenticated at index ${revocationLeafIndex}.` });

  // 6. Consistency: the smaller checkpoint's root is a prefix of the larger's.
  //    This binds the two authenticated leaf positions into ONE append-only log,
  //    making their index comparison meaningful.
  const [earlier, later] =
    inclusionCp.tree_size <= revocationCp.tree_size
      ? [inclusionCp, revocationCp]
      : [revocationCp, inclusionCp];
  const consistencyOk =
    input.consistency.old_tree_size === earlier.tree_size &&
    input.consistency.new_tree_size === later.tree_size &&
    verifyConsistencyProof({
      oldRootHash: earlier.root_hash,
      newRootHash: later.root_hash,
      proof: input.consistency,
    });
  if (!consistencyOk) {
    checks.push({ name: "append_only_consistency", passed: false, detail: "Consistency proof does not bind the two checkpoints into one append-only log." });
    return reject("rejected_unprovable", "Cannot prove the two checkpoints are the same append-only log.", checks, { receiptLeafIndex, revocationLeafIndex });
  }
  checks.push({ name: "append_only_consistency", passed: true, detail: `Checkpoints are consistent: tree_size ${earlier.tree_size} is a prefix of ${later.tree_size}.` });

  // 7. Backdating detection (labels the attack; never changes the verdict).
  let backdatingSuspected = false;
  if (typeof input.receiptTimestamp === "string") {
    const claimed = Date.parse(input.receiptTimestamp);
    const revocationSealed = Date.parse(revocationCp.integrated_time);
    if (
      Number.isFinite(claimed) &&
      Number.isFinite(revocationSealed) &&
      claimed < revocationSealed &&
      receiptLeafIndex >= revocationLeafIndex
    ) {
      backdatingSuspected = true;
      checks.push({
        name: "backdating_detector",
        passed: false,
        detail: `Self-reported timestamp ${input.receiptTimestamp} claims pre-revocation, but authenticated ledger position (${receiptLeafIndex}) is at or after revocation (${revocationLeafIndex}). Backdating suspected.`,
      });
    } else {
      checks.push({ name: "backdating_detector", passed: true, detail: "No clock-vs-ledger contradiction detected." });
    }
  }

  // 8. Ordering theorem: pre-revocation iff the receipt's authenticated index
  //    strictly precedes the revocation record's authenticated index.
  const pre = receiptLeafIndex < revocationLeafIndex;
  checks.push({
    name: "authenticated_order",
    passed: pre,
    detail: pre
      ? `Receipt index ${receiptLeafIndex} precedes revocation index ${revocationLeafIndex}.`
      : `Receipt index ${receiptLeafIndex} is at or after revocation index ${revocationLeafIndex}.`,
  });

  return {
    schemaVersion: authenticatedRevocationSchemaVersion,
    verdict: pre,
    standing: pre ? "valid_pre_revocation" : "rejected_post_revocation",
    receiptLeafIndex,
    revocationLeafIndex,
    backdatingSuspected,
    checks,
    detail: pre
      ? "Receipt was committed to the authenticated log before the revocation record."
      : "Receipt was committed to the authenticated log at or after revocation; rejected regardless of its self-reported timestamp.",
    nonClaim: NON_CLAIM,
  };
}

/**
 * Best-effort extraction of an optional `reason` from a candidate revocation
 * leaf payload, so a record that legitimately carries a reason still matches.
 * Returns undefined if the payload is not parseable JSON or has no reason; the
 * caller then compares against the reason-less canonical form.
 */
function revocationRecordReason(leafPayload: string): string | undefined {
  try {
    const parsed = JSON.parse(leafPayload) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : undefined;
  } catch {
    return undefined;
  }
}
