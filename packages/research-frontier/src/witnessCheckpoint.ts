import { createSign, createVerify, generateKeyPairSync } from "crypto";
import { computeMerkleRoot } from "./merkle";

export type WitnessSignatureAlgorithm = "ecdsa-p256-sha256";

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
