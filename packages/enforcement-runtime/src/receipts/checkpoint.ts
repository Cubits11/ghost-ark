import { canonicalSha256Hex, canonicalize, sha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import type { DecisionReceiptAsyncSigner } from "./emission";
import { DecisionReceiptChainHead, DecisionReceiptRepository } from "./repository";

export const epochCheckpointSchemaVersion = "ghost.receipt_checkpoint.v1" as const;

export interface ReceiptChainHeadLeaf {
  tenantId: string;
  headHash: string;
}

export interface MerkleProofStep {
  position: "left" | "right";
  hash: string;
}

export interface MerkleInclusionProof {
  leaf: ReceiptChainHeadLeaf;
  leafHash: string;
  proof: MerkleProofStep[];
  root: string;
}

export interface UnsignedEpochCheckpoint {
  schemaVersion: typeof epochCheckpointSchemaVersion;
  epochId: string;
  createdAt: string;
  leafCount: number;
  merkleRoot: string;
  leavesHash: string;
}

export interface SignedEpochCheckpoint extends UnsignedEpochCheckpoint {
  signatureAlg: string;
  signerKeyId: string;
  signature: string;
}

export interface EpochCheckpointVerificationResult {
  verdict: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

export interface EpochCheckpointRepository {
  put(checkpoint: SignedEpochCheckpoint): Promise<void>;
}

export interface EpochCheckpointCanonicalVerifier {
  readonly algorithm: string;
  readonly keyId?: string;
  verifyCanonical(canonicalPayload: string, signature: string, checkpoint: SignedEpochCheckpoint): boolean | Promise<boolean>;
}

export function normalizeChainHeadLeaves(heads: Array<DecisionReceiptChainHead | ReceiptChainHeadLeaf>): ReceiptChainHeadLeaf[] {
  const seen = new Map<string, ReceiptChainHeadLeaf>();
  for (const head of heads) {
    seen.set(head.tenantId, { tenantId: head.tenantId, headHash: head.headHash });
  }
  return [...seen.values()].sort((left, right) => left.tenantId.localeCompare(right.tenantId));
}

export function receiptChainHeadLeafHash(leaf: ReceiptChainHeadLeaf): string {
  return `sha256:${canonicalSha256Hex({
    domain: "ghost-ark.receipt-chain-head.leaf.v1",
    tenantId: leaf.tenantId,
    headHash: leaf.headHash
  })}`;
}

export function merkleParentHash(left: string, right: string): string {
  return `sha256:${sha256Hex(`ghost-ark.receipt-checkpoint.node.v1:${left}:${right}`)}`;
}

export function merkleRootForLeaves(leaves: ReceiptChainHeadLeaf[]): string {
  let layer = normalizeChainHeadLeaves(leaves).map(receiptChainHeadLeafHash);
  if (layer.length === 0) {
    return `sha256:${sha256Hex("ghost-ark.receipt-checkpoint.empty.v1")}`;
  }
  while (layer.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      next.push(merkleParentHash(left, right));
    }
    layer = next;
  }
  return layer[0];
}

export function buildMerkleInclusionProof(
  leaves: ReceiptChainHeadLeaf[],
  target: ReceiptChainHeadLeaf
): MerkleInclusionProof {
  const normalized = normalizeChainHeadLeaves(leaves);
  const targetIndex = normalized.findIndex((leaf) => leaf.tenantId === target.tenantId && leaf.headHash === target.headHash);
  if (targetIndex < 0) {
    throw new Error("Target chain head leaf is not present in the checkpoint leaves");
  }

  let index = targetIndex;
  let layer = normalized.map(receiptChainHeadLeafHash);
  const proof: MerkleProofStep[] = [];
  while (layer.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const siblingHash = layer[siblingIndex] ?? layer[index];
    proof.push({ position: index % 2 === 0 ? "right" : "left", hash: siblingHash });

    const next: string[] = [];
    for (let cursor = 0; cursor < layer.length; cursor += 2) {
      const left = layer[cursor];
      const right = layer[cursor + 1] ?? left;
      next.push(merkleParentHash(left, right));
    }
    layer = next;
    index = Math.floor(index / 2);
  }

  return {
    leaf: target,
    leafHash: receiptChainHeadLeafHash(target),
    proof,
    root: layer[0] ?? merkleRootForLeaves([])
  };
}

export function verifyMerkleInclusionProof(proof: MerkleInclusionProof, expectedRoot = proof.root): boolean {
  let computed = receiptChainHeadLeafHash(proof.leaf);
  if (computed !== proof.leafHash) {
    return false;
  }
  for (const step of proof.proof) {
    computed = step.position === "left" ? merkleParentHash(step.hash, computed) : merkleParentHash(computed, step.hash);
  }
  return computed === expectedRoot;
}

export function buildUnsignedEpochCheckpoint(input: {
  epochId: string;
  createdAt: string;
  leaves: ReceiptChainHeadLeaf[];
}): UnsignedEpochCheckpoint {
  const leaves = normalizeChainHeadLeaves(input.leaves);
  return {
    schemaVersion: epochCheckpointSchemaVersion,
    epochId: input.epochId,
    createdAt: input.createdAt,
    leafCount: leaves.length,
    merkleRoot: merkleRootForLeaves(leaves),
    leavesHash: `sha256:${canonicalSha256Hex(leaves)}`
  };
}

export async function signEpochCheckpoint(input: {
  epochId: string;
  createdAt: string;
  leaves: ReceiptChainHeadLeaf[];
  signer: DecisionReceiptAsyncSigner;
}): Promise<SignedEpochCheckpoint> {
  const unsigned = buildUnsignedEpochCheckpoint(input);
  const canonicalPayload = canonicalize(unsigned);
  const signature = await input.signer.signCanonical(canonicalPayload);
  return {
    ...unsigned,
    signatureAlg: input.signer.algorithm,
    signerKeyId: input.signer.keyId,
    signature
  };
}

export async function createSignedEpochCheckpoint(input: {
  epochId: string;
  createdAt: string;
  receiptRepository: Pick<DecisionReceiptRepository, "listChainHeads">;
  signer: DecisionReceiptAsyncSigner;
  checkpointRepository?: EpochCheckpointRepository;
}): Promise<SignedEpochCheckpoint> {
  if (!input.receiptRepository.listChainHeads) {
    throw new Error("Receipt repository does not support listing tenant chain heads");
  }

  const chainHeads = await input.receiptRepository.listChainHeads();
  const checkpoint = await signEpochCheckpoint({
    epochId: input.epochId,
    createdAt: input.createdAt,
    leaves: chainHeads,
    signer: input.signer
  });
  await input.checkpointRepository?.put(checkpoint);
  return checkpoint;
}

export async function verifyEpochCheckpoint(
  checkpoint: SignedEpochCheckpoint,
  verifier: EpochCheckpointCanonicalVerifier
): Promise<EpochCheckpointVerificationResult> {
  const checks: EpochCheckpointVerificationResult["checks"] = [];
  const unsigned: UnsignedEpochCheckpoint = {
    schemaVersion: checkpoint.schemaVersion,
    epochId: checkpoint.epochId,
    createdAt: checkpoint.createdAt,
    leafCount: checkpoint.leafCount,
    merkleRoot: checkpoint.merkleRoot,
    leavesHash: checkpoint.leavesHash
  };
  checks.push({
    name: "schema",
    passed: checkpoint.schemaVersion === epochCheckpointSchemaVersion,
    detail:
      checkpoint.schemaVersion === epochCheckpointSchemaVersion
        ? "Checkpoint schema version is supported."
        : `Unsupported checkpoint schema ${checkpoint.schemaVersion}.`
  });
  checks.push({
    name: "algorithm",
    passed: checkpoint.signatureAlg === verifier.algorithm,
    detail:
      checkpoint.signatureAlg === verifier.algorithm
        ? `Checkpoint signature algorithm ${checkpoint.signatureAlg} is expected.`
        : `Unexpected checkpoint signature algorithm ${checkpoint.signatureAlg}.`
  });
  checks.push({
    name: "key_id",
    passed: !verifier.keyId || checkpoint.signerKeyId === verifier.keyId,
    detail:
      !verifier.keyId || checkpoint.signerKeyId === verifier.keyId
        ? `Checkpoint signer keyId ${checkpoint.signerKeyId} is accepted.`
        : `Checkpoint signer keyId mismatch. Expected ${verifier.keyId}; observed ${checkpoint.signerKeyId}.`
  });

  let signaturePassed = false;
  let detail = "Checkpoint signature verification completed.";
  try {
    signaturePassed = await verifier.verifyCanonical(canonicalize(unsigned), checkpoint.signature, checkpoint);
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  checks.push({ name: "signature", passed: signaturePassed, detail });
  return { verdict: checks.every((check) => check.passed), checks };
}
