import {
  type WitnessCheckpoint,
  type WitnessKeyManifest,
  canonicalCheckpointPayload,
  findWitnessKeyManifestEntry,
  verifyCheckpointSignature,
  verifyWitnessKeyManifestEpoch,
} from "./witnessCheckpoint";

// Maturity/assumption annotations for `npm run assumptions`
// (see docs/architecture/ASSUMPTION_LATTICE.md).
export const MATURITY = "RESEARCH" as const;
export const ASSUMPTIONS = [
  "A_SHA256_COLLISION_RESISTANCE",
  "A_WITNESS_KEY_MANIFEST_AUTHENTIC",
] as const;

/**
 * Witness split-view (equivocation) fraud proofs.
 *
 * Mechanism-design context (see docs/research/WITNESS_MECHANISM_DESIGN.md):
 *   A transparency log with a single self-signed witness can serve one Merkle
 *   root to an auditor and a different root to a user for the same tree size —
 *   a split view. No amount of local RFC 6962 correctness detects this, because
 *   each view is internally consistent.
 *
 *   The enforcement primitive is a *self-contained fraud proof*: if a witness
 *   signs two checkpoints that assert the same (log_id, tree_size) but different
 *   roots, that pair is offline-verifiable evidence — under the witness's own
 *   key — that the log equivocated. Any party holding both signed heads can prove
 *   misbehavior without trusting anyone.
 *
 * Scope (deliberately narrow — see the doc for the open problems):
 *   - SINGLE-witness equivocation only. A split view co-signed by *different*
 *     witnesses across the two views produces disjoint signer sets and is NOT
 *     detected here.
 *   - SAME-tree_size only. A fork at different tree sizes (a non-append-only
 *     rewrite) surfaces as a broken consistency proof, not as this proof.
 *   - Assumes log_id identifies ONE append-only incarnation. Reusing a log_id
 *     across a reset is itself a violation and out of scope; under that
 *     assumption, same-(log_id,tree_size) different-root is equivocation
 *     regardless of integrated_time.
 *
 * Non-claim: a valid fraud proof demonstrates single-witness equivocation for
 * the recorded heads under the log_id-non-reuse assumption. It does not prove
 * which view is canonical, that any recorded decision was correct, or that the
 * federation is live. Absence of a fraud proof is not evidence of honesty.
 */

export const splitViewFraudProofSchemaVersion =
  "ghostark.research.witness_split_view_fraud_proof.v1" as const;

export interface SplitViewFraudProof {
  schema_version: typeof splitViewFraudProofSchemaVersion;
  log_id: string;
  witness_id: string;
  tree_size: number;
  checkpoint_a: WitnessCheckpoint;
  checkpoint_b: WitnessCheckpoint;
}

export interface FraudProofCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface FraudProofVerification {
  valid: boolean;
  checks: FraudProofCheck[];
}

function witnessSignatureVerifies(
  checkpoint: WitnessCheckpoint,
  witnessId: string,
  manifest: WitnessKeyManifest,
): boolean {
  const signature = checkpoint.witness_signatures.find((s) => s.witness_id === witnessId);
  if (!signature) {
    return false;
  }
  const epoch = verifyWitnessKeyManifestEpoch({
    manifest,
    witnessId,
    signatureAlgorithm: signature.signature_algorithm,
    integratedTime: checkpoint.integrated_time,
  });
  if (!epoch.passed) {
    return false;
  }
  const entry = findWitnessKeyManifestEntry(manifest, witnessId, signature.signature_algorithm);
  if (entry === null) {
    return false;
  }
  const payload = canonicalCheckpointPayload({
    schema_version: checkpoint.schema_version,
    log_id: checkpoint.log_id,
    tree_size: checkpoint.tree_size,
    root_hash: checkpoint.root_hash,
    integrated_time: checkpoint.integrated_time,
  });
  return verifyCheckpointSignature({
    payload,
    signature: signature.signature,
    publicKeyPem: entry.public_key_pem,
  });
}

/**
 * Independently verify a split-view fraud proof. Returns a full check trail so a
 * skeptic can see exactly which conditions established the equivocation.
 */
export function verifySplitViewFraudProof(
  proof: SplitViewFraudProof,
  manifest: WitnessKeyManifest,
): FraudProofVerification {
  const checks: FraudProofCheck[] = [];

  const schemaOk = proof.schema_version === splitViewFraudProofSchemaVersion;
  checks.push({ name: "schema", passed: schemaOk, detail: schemaOk ? "Fraud proof schema is supported." : `Unsupported schema ${proof.schema_version}.` });

  const a = proof.checkpoint_a;
  const b = proof.checkpoint_b;

  const sameLog = a.log_id === proof.log_id && b.log_id === proof.log_id;
  checks.push({ name: "same_log", passed: sameLog, detail: sameLog ? `Both heads bind log ${proof.log_id}.` : "Checkpoints do not share the claimed log_id." });

  const sameSize = a.tree_size === proof.tree_size && b.tree_size === proof.tree_size;
  checks.push({ name: "same_tree_size", passed: sameSize, detail: sameSize ? `Both heads assert tree_size ${proof.tree_size}.` : "Checkpoints do not share the claimed tree_size." });

  const rootsDiffer = a.root_hash !== b.root_hash;
  checks.push({ name: "roots_differ", passed: rootsDiffer, detail: rootsDiffer ? `Conflicting roots ${a.root_hash.slice(0, 16)}… vs ${b.root_hash.slice(0, 16)}….` : "Roots are identical; no equivocation." });

  const aSigned = witnessSignatureVerifies(a, proof.witness_id, manifest);
  checks.push({ name: "signature_a", passed: aSigned, detail: aSigned ? `Witness ${proof.witness_id} signed head A.` : "Witness signature on head A does not verify." });

  const bSigned = witnessSignatureVerifies(b, proof.witness_id, manifest);
  checks.push({ name: "signature_b", passed: bSigned, detail: bSigned ? `Witness ${proof.witness_id} signed head B.` : "Witness signature on head B does not verify." });

  return { valid: checks.every((c) => c.passed), checks };
}

interface WitnessGroup {
  logId: string;
  witnessId: string;
  treeSize: number;
  checkpoints: WitnessCheckpoint[];
}

/**
 * Scan a set of witness checkpoints for a single-witness equivocation and, if
 * found, emit a fraud proof. Groups by (log_id, witness_id, tree_size); a group
 * holding two validly-signed heads with different roots is proof of a split view.
 */
export function detectSplitView(
  checkpoints: WitnessCheckpoint[],
  manifest: WitnessKeyManifest,
): SplitViewFraudProof | null {
  // JSON-tuple key: escaping makes grouping injection-safe for arbitrary
  // log_id / witness_id, and the parsed identity is stored, never re-parsed out
  // of a delimited string.
  const groups = new Map<string, WitnessGroup>();
  for (const checkpoint of checkpoints) {
    for (const signature of checkpoint.witness_signatures) {
      const key = JSON.stringify([checkpoint.log_id, signature.witness_id, checkpoint.tree_size]);
      const group: WitnessGroup = groups.get(key) ?? {
        logId: checkpoint.log_id,
        witnessId: signature.witness_id,
        treeSize: checkpoint.tree_size,
        checkpoints: [],
      };
      group.checkpoints.push(checkpoint);
      groups.set(key, group);
    }
  }

  for (const group of groups.values()) {
    const bucket = group.checkpoints;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (bucket[i].root_hash === bucket[j].root_hash) {
          continue;
        }
        const candidate: SplitViewFraudProof = {
          schema_version: splitViewFraudProofSchemaVersion,
          log_id: group.logId,
          witness_id: group.witnessId,
          tree_size: group.treeSize,
          checkpoint_a: bucket[i],
          checkpoint_b: bucket[j],
        };
        if (verifySplitViewFraudProof(candidate, manifest).valid) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Federation-level split view (Phase II: multi-witness / disjoint-signer fork).
 *
 * `detectSplitView` blames a SINGLE witness who signed two roots. But an honest
 * quorum should never let TWO different roots for the same (log_id, tree_size)
 * each accrue a quorum of valid signatures — even from disjoint witness sets. If
 * that happens, no individual witness equivocated, yet the federation as a whole
 * served two histories. This proof captures exactly that: a pair of
 * quorum-signed conflicting heads at the same size.
 *
 * Attribution is weaker than the single-witness proof (it does not name one
 * guilty key), but it is still offline-verifiable and is sufficient to refuse to
 * trust the log's order.
 *
 * Scope: SAME tree_size only. A history rewrite at DIFFERENT tree sizes is not
 * captured here — it surfaces as a failed consistency proof at decision time.
 */
export const federationSplitViewProofSchemaVersion =
  "ghostark.research.witness_federation_split_view_proof.v1" as const;

export interface FederationSplitViewProof {
  schema_version: typeof federationSplitViewProofSchemaVersion;
  log_id: string;
  tree_size: number;
  quorum: number;
  checkpoint_a: WitnessCheckpoint;
  checkpoint_b: WitnessCheckpoint;
}

/** Count DISTINCT witness_ids on a checkpoint whose signatures validly verify. */
export function countValidWitnesses(
  checkpoint: WitnessCheckpoint,
  manifest: WitnessKeyManifest,
): number {
  const valid = new Set<string>();
  for (const signature of checkpoint.witness_signatures) {
    if (witnessSignatureVerifies(checkpoint, signature.witness_id, manifest)) {
      valid.add(signature.witness_id);
    }
  }
  return valid.size;
}

/** Independently verify a federation split-view proof. */
export function verifyFederationSplitViewProof(
  proof: FederationSplitViewProof,
  manifest: WitnessKeyManifest,
): FraudProofVerification {
  const checks: FraudProofCheck[] = [];
  const a = proof.checkpoint_a;
  const b = proof.checkpoint_b;

  const schemaOk = proof.schema_version === federationSplitViewProofSchemaVersion;
  checks.push({ name: "schema", passed: schemaOk, detail: schemaOk ? "Federation fraud proof schema is supported." : `Unsupported schema ${proof.schema_version}.` });

  const quorumOk = Number.isSafeInteger(proof.quorum) && proof.quorum >= 1;
  checks.push({ name: "quorum_configured", passed: quorumOk, detail: quorumOk ? `Quorum ${proof.quorum}.` : "Quorum must be a positive integer." });

  const sameLog = a.log_id === proof.log_id && b.log_id === proof.log_id;
  checks.push({ name: "same_log", passed: sameLog, detail: sameLog ? `Both heads bind log ${proof.log_id}.` : "Checkpoints do not share the claimed log_id." });

  const sameSize = a.tree_size === proof.tree_size && b.tree_size === proof.tree_size;
  checks.push({ name: "same_tree_size", passed: sameSize, detail: sameSize ? `Both heads assert tree_size ${proof.tree_size}.` : "Checkpoints do not share the claimed tree_size." });

  const rootsDiffer = a.root_hash !== b.root_hash;
  checks.push({ name: "roots_differ", passed: rootsDiffer, detail: rootsDiffer ? "Conflicting roots at the same size." : "Roots are identical; no equivocation." });

  const aQuorum = quorumOk && countValidWitnesses(a, manifest) >= proof.quorum;
  checks.push({ name: "quorum_a", passed: aQuorum, detail: aQuorum ? "Head A meets quorum." : "Head A does not meet quorum of valid witnesses." });

  const bQuorum = quorumOk && countValidWitnesses(b, manifest) >= proof.quorum;
  checks.push({ name: "quorum_b", passed: bQuorum, detail: bQuorum ? "Head B meets quorum." : "Head B does not meet quorum of valid witnesses." });

  return { valid: checks.every((c) => c.passed), checks };
}

/**
 * Scan checkpoints for a federation-level split view: two conflicting roots at
 * the same (log_id, tree_size) that EACH meet the witness quorum. Emits a proof.
 */
export function detectFederationSplitView(
  checkpoints: WitnessCheckpoint[],
  manifest: WitnessKeyManifest,
  quorum: number,
): FederationSplitViewProof | null {
  const groups = new Map<string, WitnessCheckpoint[]>();
  for (const checkpoint of checkpoints) {
    const key = JSON.stringify([checkpoint.log_id, checkpoint.tree_size]);
    const bucket = groups.get(key) ?? [];
    bucket.push(checkpoint);
    groups.set(key, bucket);
  }

  for (const bucket of groups.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (bucket[i].root_hash === bucket[j].root_hash) {
          continue;
        }
        const candidate: FederationSplitViewProof = {
          schema_version: federationSplitViewProofSchemaVersion,
          log_id: bucket[i].log_id,
          tree_size: bucket[i].tree_size,
          quorum,
          checkpoint_a: bucket[i],
          checkpoint_b: bucket[j],
        };
        if (verifyFederationSplitViewProof(candidate, manifest).valid) {
          return candidate;
        }
      }
    }
  }
  return null;
}
