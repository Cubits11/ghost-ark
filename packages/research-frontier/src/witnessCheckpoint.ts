import { createSign, createVerify, generateKeyPairSync } from "crypto";
import {
  assertSha256Hex,
  computeMerkleRoot,
  getConsistencyProof,
  type MerkleConsistencyProof,
  verifyConsistencyProof,
} from "./merkle";

export type WitnessSignatureAlgorithm = "ecdsa-p256-sha256";
export type WitnessKeyManifestStatus = "ACTIVE" | "DEPRECATED" | "REVOKED";

export interface WitnessSignature {
  witness_id: string;
  signature_algorithm: WitnessSignatureAlgorithm;
  signature: string;
}

export interface WitnessCheckpoint {
  schema_version: "ghostark.research.witness_checkpoint.v1";
  log_id: string;
  tree_size: number;
  root_hash: string;
  integrated_time: string;
  witness_signatures: WitnessSignature[];
}

export interface DevWitnessKeyPair {
  witnessId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface WitnessKeyManifestEntry {
  witness_id: string;
  signature_algorithm: WitnessSignatureAlgorithm;
  public_key_pem: string;
  valid_from: string;
  valid_until?: string;
  status: WitnessKeyManifestStatus;
  revoked_at?: string;
  reason?: string;
}

export interface WitnessKeyManifest {
  schema_version: "ghostark.research.witness_key_manifest.v1";
  generated_at: string;
  witnesses: WitnessKeyManifestEntry[];
}

export interface WitnessKeyManifestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface WitnessCheckpointConsistencyProof
  extends MerkleConsistencyProof {
  schema_version: "ghostark.research.witness_checkpoint_consistency_proof.v1";
  log_id: string;
  old_root_hash: string;
  new_root_hash: string;
}

type WitnessCheckpointSummary = Pick<
  WitnessCheckpoint,
  "log_id" | "tree_size" | "root_hash"
>;

export function createDevWitnessKeyPair(witnessId: string): DevWitnessKeyPair {
  // Local dev keys keep this research primitive testable without a witness service.
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  return {
    witnessId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

export function canonicalCheckpointPayload(
  checkpoint: Omit<WitnessCheckpoint, "witness_signatures">,
): string {
  return JSON.stringify({
    integrated_time: checkpoint.integrated_time,
    log_id: checkpoint.log_id,
    root_hash: checkpoint.root_hash,
    schema_version: checkpoint.schema_version,
    tree_size: checkpoint.tree_size,
  });
}

export function signCheckpointPayload(
  payload: string,
  privateKeyPem: string,
): string {
  const signer = createSign("sha256");
  signer.update(payload);
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

export function verifyCheckpointSignature(params: {
  payload: string;
  signature: string;
  publicKeyPem: string;
}): boolean {
  const verifier = createVerify("sha256");
  verifier.update(params.payload);
  verifier.end();
  return verifier.verify(params.publicKeyPem, params.signature, "base64");
}

export function validateWitnessKeyManifestSemantics(
  manifest: WitnessKeyManifest,
): void {
  if (manifest.schema_version !== "ghostark.research.witness_key_manifest.v1") {
    throw new Error("Witness key manifest schema_version is unsupported");
  }

  if (!Number.isFinite(Date.parse(manifest.generated_at))) {
    throw new Error("Witness key manifest generated_at must be a date-time");
  }

  if (!Array.isArray(manifest.witnesses) || manifest.witnesses.length === 0) {
    throw new Error("Witness key manifest requires at least one witness");
  }

  const seen = new Set<string>();
  for (const [index, witness] of manifest.witnesses.entries()) {
    const identity = `${witness.witness_id}:${witness.signature_algorithm}`;
    if (seen.has(identity)) {
      throw new Error(`Duplicate witness key manifest entry for ${identity}`);
    }
    seen.add(identity);

    if (!witness.witness_id) {
      throw new Error(`Witness key manifest entry ${index} requires witness_id`);
    }
    if (witness.signature_algorithm !== "ecdsa-p256-sha256") {
      throw new Error(`Unsupported witness signature algorithm ${witness.signature_algorithm}`);
    }
    if (!witness.public_key_pem) {
      throw new Error(`Witness key manifest entry ${identity} requires public_key_pem`);
    }
    if (!["ACTIVE", "DEPRECATED", "REVOKED"].includes(witness.status)) {
      throw new Error(`Witness key manifest entry ${identity} has unsupported status`);
    }

    const validFrom = Date.parse(witness.valid_from);
    const validUntil = witness.valid_until
      ? Date.parse(witness.valid_until)
      : undefined;
    const revokedAt = witness.revoked_at
      ? Date.parse(witness.revoked_at)
      : undefined;

    if (!Number.isFinite(validFrom)) {
      throw new Error(`Witness key manifest entry ${identity} valid_from must be a date-time`);
    }
    if (validUntil !== undefined && validUntil <= validFrom) {
      throw new Error(`Witness key manifest entry ${identity} valid_until must be later than valid_from`);
    }
    if (revokedAt !== undefined && revokedAt < validFrom) {
      throw new Error(`Witness key manifest entry ${identity} revoked_at cannot be earlier than valid_from`);
    }
  }
}

export function findWitnessKeyManifestEntry(
  manifest: WitnessKeyManifest,
  witnessId: string,
  signatureAlgorithm: WitnessSignatureAlgorithm,
): WitnessKeyManifestEntry | null {
  return (
    manifest.witnesses.find(
      (entry) =>
        entry.witness_id === witnessId &&
        entry.signature_algorithm === signatureAlgorithm,
    ) ??
    manifest.witnesses.find((entry) => entry.witness_id === witnessId) ??
    null
  );
}

export function verifyWitnessKeyManifestEpoch(params: {
  manifest: WitnessKeyManifest;
  witnessId: string;
  signatureAlgorithm: WitnessSignatureAlgorithm;
  integratedTime: string;
}): WitnessKeyManifestCheck {
  try {
    validateWitnessKeyManifestSemantics(params.manifest);
  } catch (error) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Witness key manifest is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const entry = findWitnessKeyManifestEntry(
    params.manifest,
    params.witnessId,
    params.signatureAlgorithm,
  );
  if (!entry) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `No witness key manifest entry exists for witness ${params.witnessId}.`,
    };
  }
  if (entry.signature_algorithm !== params.signatureAlgorithm) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Witness algorithm mismatch. Expected ${entry.signature_algorithm}; observed ${params.signatureAlgorithm}.`,
    };
  }

  const observed = Date.parse(params.integratedTime);
  const validFrom = Date.parse(entry.valid_from);
  const validUntil = entry.valid_until
    ? Date.parse(entry.valid_until)
    : Number.POSITIVE_INFINITY;
  const revokedAt = entry.revoked_at ? Date.parse(entry.revoked_at) : undefined;

  if (!Number.isFinite(observed)) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Checkpoint integrated_time is not parseable: ${params.integratedTime}.`,
    };
  }
  if (observed < validFrom) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Checkpoint integrated_time ${params.integratedTime} is before witness valid_from ${entry.valid_from}.`,
    };
  }
  if (observed >= validUntil) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Checkpoint integrated_time ${params.integratedTime} is not before witness valid_until ${entry.valid_until}.`,
    };
  }
  if (entry.status === "REVOKED" && revokedAt === undefined) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Witness ${entry.witness_id} is revoked without a revoked_at timestamp.`,
    };
  }
  if (revokedAt !== undefined && observed >= revokedAt) {
    return {
      name: "witness_key_manifest",
      passed: false,
      detail: `Checkpoint integrated_time ${params.integratedTime} is at or after witness revoked_at ${entry.revoked_at}.`,
    };
  }

  return {
    name: "witness_key_manifest",
    passed: true,
    detail:
      entry.status === "REVOKED"
        ? `Witness ${entry.witness_id} was revoked after this historical checkpoint.`
        : `Witness ${entry.witness_id} is ${entry.status} for the checkpoint integrated_time.`,
  };
}

export function verifyWitnessCheckpointSignaturesWithManifest(params: {
  checkpoint: WitnessCheckpoint;
  manifest: WitnessKeyManifest;
}): boolean {
  try {
    validateWitnessKeyManifestSemantics(params.manifest);

    const payload = canonicalCheckpointPayload({
      schema_version: params.checkpoint.schema_version,
      log_id: params.checkpoint.log_id,
      tree_size: params.checkpoint.tree_size,
      root_hash: params.checkpoint.root_hash,
      integrated_time: params.checkpoint.integrated_time,
    });

    return params.checkpoint.witness_signatures.every((signature) => {
      const epoch = verifyWitnessKeyManifestEpoch({
        manifest: params.manifest,
        witnessId: signature.witness_id,
        signatureAlgorithm: signature.signature_algorithm,
        integratedTime: params.checkpoint.integrated_time,
      });
      if (!epoch.passed) {
        return false;
      }

      const entry = findWitnessKeyManifestEntry(
        params.manifest,
        signature.witness_id,
        signature.signature_algorithm,
      );
      return (
        entry !== null &&
        verifyCheckpointSignature({
          payload,
          signature: signature.signature,
          publicKeyPem: entry.public_key_pem,
        })
      );
    });
  } catch {
    return false;
  }
}

export function createWitnessCheckpoint(params: {
  logId: string;
  receiptPayloads: string[];
  integratedTime: string;
  witness: DevWitnessKeyPair;
}): WitnessCheckpoint {
  const unsigned: Omit<WitnessCheckpoint, "witness_signatures"> = {
    schema_version: "ghostark.research.witness_checkpoint.v1" as const,
    log_id: params.logId,
    tree_size: params.receiptPayloads.length,
    root_hash: computeMerkleRoot(params.receiptPayloads),
    integrated_time: params.integratedTime,
  };

  const payload = canonicalCheckpointPayload(unsigned);
  const signature = signCheckpointPayload(payload, params.witness.privateKeyPem);

  return {
    schema_version: unsigned.schema_version,
    log_id: unsigned.log_id,
    tree_size: unsigned.tree_size,
    root_hash: unsigned.root_hash,
    integrated_time: unsigned.integrated_time,
    witness_signatures: [
      {
        witness_id: params.witness.witnessId,
        signature_algorithm: "ecdsa-p256-sha256",
        signature,
      },
    ],
  };
}

export function createWitnessCheckpointConsistencyProof(params: {
  previousCheckpoint: WitnessCheckpointSummary;
  newCheckpoint: WitnessCheckpointSummary;
  receiptPayloads: string[];
}): WitnessCheckpointConsistencyProof {
  assertConsistentCheckpointPair(
    params.previousCheckpoint,
    params.newCheckpoint,
  );

  if (params.receiptPayloads.length !== params.newCheckpoint.tree_size) {
    throw new Error("receiptPayloads length must match new checkpoint tree_size");
  }

  const expectedOldRoot = computeMerkleRoot(
    params.receiptPayloads.slice(0, params.previousCheckpoint.tree_size),
  );
  if (expectedOldRoot !== params.previousCheckpoint.root_hash) {
    throw new Error("previous checkpoint root is not a prefix of receiptPayloads");
  }

  const expectedNewRoot = computeMerkleRoot(params.receiptPayloads);
  if (expectedNewRoot !== params.newCheckpoint.root_hash) {
    throw new Error("new checkpoint root does not match receiptPayloads");
  }

  const proof = getConsistencyProof(
    params.previousCheckpoint.tree_size,
    params.receiptPayloads,
  );

  return {
    schema_version:
      "ghostark.research.witness_checkpoint_consistency_proof.v1",
    log_id: params.newCheckpoint.log_id,
    old_tree_size: proof.old_tree_size,
    new_tree_size: proof.new_tree_size,
    old_root_hash: params.previousCheckpoint.root_hash,
    new_root_hash: params.newCheckpoint.root_hash,
    audit_path: proof.audit_path,
  };
}

export function verifyWitnessCheckpointConsistencyProof(params: {
  previousCheckpoint: WitnessCheckpointSummary;
  newCheckpoint: WitnessCheckpointSummary;
  proof: WitnessCheckpointConsistencyProof;
}): boolean {
  try {
    assertConsistentCheckpointPair(
      params.previousCheckpoint,
      params.newCheckpoint,
    );

    if (
      params.proof.schema_version !==
      "ghostark.research.witness_checkpoint_consistency_proof.v1"
    ) {
      return false;
    }

    if (
      params.proof.log_id !== params.previousCheckpoint.log_id ||
      params.proof.log_id !== params.newCheckpoint.log_id ||
      params.proof.old_tree_size !== params.previousCheckpoint.tree_size ||
      params.proof.new_tree_size !== params.newCheckpoint.tree_size ||
      params.proof.old_root_hash !== params.previousCheckpoint.root_hash ||
      params.proof.new_root_hash !== params.newCheckpoint.root_hash
    ) {
      return false;
    }

    return verifyConsistencyProof({
      oldRootHash: params.previousCheckpoint.root_hash,
      newRootHash: params.newCheckpoint.root_hash,
      proof: params.proof,
    });
  } catch {
    return false;
  }
}

function assertConsistentCheckpointPair(
  previousCheckpoint: WitnessCheckpointSummary,
  newCheckpoint: WitnessCheckpointSummary,
): void {
  if (previousCheckpoint.log_id !== newCheckpoint.log_id) {
    throw new Error("checkpoint log_id values must match");
  }

  if (
    !Number.isSafeInteger(previousCheckpoint.tree_size) ||
    previousCheckpoint.tree_size < 0 ||
    !Number.isSafeInteger(newCheckpoint.tree_size) ||
    newCheckpoint.tree_size < 0
  ) {
    throw new Error("checkpoint tree_size values must be non-negative safe integers");
  }

  if (previousCheckpoint.tree_size > newCheckpoint.tree_size) {
    throw new Error("previous checkpoint tree_size cannot exceed new checkpoint tree_size");
  }

  assertSha256Hex(previousCheckpoint.root_hash, "previous checkpoint root_hash");
  assertSha256Hex(newCheckpoint.root_hash, "new checkpoint root_hash");
}
