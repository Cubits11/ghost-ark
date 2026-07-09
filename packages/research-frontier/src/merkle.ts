import { createHash } from "crypto";

export const EMPTY_TREE_ROOT = createHash("sha256")
  .update("ghostark.empty_merkle_tree.v1")
  .digest("hex");

export interface MerkleProofStep {
  position: "left" | "right";
  hash: string;
}

export interface MerkleInclusionProof {
  tree_size: number;
  leaf_index: number;
  leaf_hash: string;
  root_hash: string;
  audit_path: MerkleProofStep[];
}

export interface MerkleConsistencyProof {
  old_tree_size: number;
  new_tree_size: number;
  audit_path: string[];
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function leafHash(payload: string): string {
  return sha256Hex(`ghostark.leaf.v1:${payload}`);
}

export function nodeHash(leftHex: string, rightHex: string): string {
  assertSha256Hex(leftHex, "leftHex");
  assertSha256Hex(rightHex, "rightHex");
  return sha256Hex(`ghostark.node.v1:${leftHex}:${rightHex}`);
}

export function computeMerkleRootFromLeafHashes(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    return EMPTY_TREE_ROOT;
  }

  for (const hash of leafHashes) {
    assertSha256Hex(hash, "leaf hash");
  }

  return merkleRootForRange(leafHashes, 0, leafHashes.length);
}

export function computeMerkleRoot(payloads: string[]): string {
  return computeMerkleRootFromLeafHashes(payloads.map(leafHash));
}

export function getInclusionProof(
  leafIndex: number,
  payloads: string[],
): MerkleInclusionProof {
  return getInclusionProofFromLeafHashes(leafIndex, payloads.map(leafHash));
}

export function getInclusionProofFromLeafHashes(
  leafIndex: number,
  leafHashes: string[],
): MerkleInclusionProof {
  assertLeafHashes(leafHashes);
  assertValidLeafIndex(leafIndex, leafHashes.length);

  return {
    tree_size: leafHashes.length,
    leaf_index: leafIndex,
    leaf_hash: leafHashes[leafIndex],
    root_hash: computeMerkleRootFromLeafHashes(leafHashes),
    audit_path: inclusionPathForRange(leafIndex, leafHashes, 0, leafHashes.length),
  };
}

export function verifyInclusionProof(params: {
  payload: string;
  proof: MerkleInclusionProof;
  expectedRoot?: string;
}): boolean {
  return verifyInclusionProofFromLeafHash({
    leafHash: leafHash(params.payload),
    proof: params.proof,
    expectedRoot: params.expectedRoot,
  });
}

export function verifyInclusionProofFromLeafHash(params: {
  leafHash: string;
  proof: MerkleInclusionProof;
  expectedRoot?: string;
}): boolean {
  try {
    assertSha256Hex(params.leafHash, "leafHash");
    assertValidLeafIndex(params.proof.leaf_index, params.proof.tree_size);
    assertSha256Hex(params.proof.leaf_hash, "proof.leaf_hash");
    assertSha256Hex(params.proof.root_hash, "proof.root_hash");

    if (params.expectedRoot !== undefined) {
      assertSha256Hex(params.expectedRoot, "expectedRoot");
    }

    if (params.leafHash !== params.proof.leaf_hash) {
      return false;
    }

    const expectedPositions = inclusionPathPositionsForRange(
      params.proof.leaf_index,
      0,
      params.proof.tree_size,
    );
    if (expectedPositions.length !== params.proof.audit_path.length) {
      return false;
    }

    let computed = params.proof.leaf_hash;
    for (let index = 0; index < params.proof.audit_path.length; index += 1) {
      const step = params.proof.audit_path[index];
      assertSha256Hex(step.hash, "proof audit path hash");
      if (step.position !== expectedPositions[index]) {
        return false;
      }

      if (step.position === "left") {
        computed = nodeHash(step.hash, computed);
      } else {
        computed = nodeHash(computed, step.hash);
      }
    }

    return computed === (params.expectedRoot ?? params.proof.root_hash);
  } catch {
    return false;
  }
}

export function getConsistencyProof(
  oldTreeSize: number,
  payloads: string[],
): MerkleConsistencyProof {
  return getConsistencyProofFromLeafHashes(oldTreeSize, payloads.map(leafHash));
}

export function getConsistencyProofFromLeafHashes(
  oldTreeSize: number,
  newLeafHashes: string[],
): MerkleConsistencyProof {
  assertLeafHashes(newLeafHashes);
  assertTreeSize(oldTreeSize, "oldTreeSize");

  if (oldTreeSize > newLeafHashes.length) {
    throw new Error("oldTreeSize must be less than or equal to new tree size");
  }

  return {
    old_tree_size: oldTreeSize,
    new_tree_size: newLeafHashes.length,
    audit_path:
      oldTreeSize === 0 || oldTreeSize === newLeafHashes.length
        ? []
        : consistencySubproof(oldTreeSize, newLeafHashes, 0, newLeafHashes.length, true),
  };
}

export function verifyConsistencyProof(params: {
  oldRootHash: string;
  newRootHash: string;
  proof: MerkleConsistencyProof;
}): boolean {
  try {
    assertSha256Hex(params.oldRootHash, "oldRootHash");
    assertSha256Hex(params.newRootHash, "newRootHash");
    assertTreeSize(params.proof.old_tree_size, "proof.old_tree_size");
    assertTreeSize(params.proof.new_tree_size, "proof.new_tree_size");

    for (const hash of params.proof.audit_path) {
      assertSha256Hex(hash, "proof audit path hash");
    }

    if (params.proof.old_tree_size > params.proof.new_tree_size) {
      return false;
    }

    if (params.proof.old_tree_size === 0) {
      return (
        params.oldRootHash === EMPTY_TREE_ROOT &&
        (params.proof.new_tree_size > 0 ||
          params.newRootHash === EMPTY_TREE_ROOT) &&
        params.proof.audit_path.length === 0
      );
    }

    if (params.proof.old_tree_size === params.proof.new_tree_size) {
      return (
        params.proof.audit_path.length === 0 &&
        params.oldRootHash === params.newRootHash
      );
    }

    const reconstructed = verifyConsistencySubproof({
      oldTreeSize: params.proof.old_tree_size,
      newTreeSize: params.proof.new_tree_size,
      includeOldRoot: true,
      auditPath: params.proof.audit_path,
      cursor: 0,
      oldRootHash: params.oldRootHash,
    });

    return (
      reconstructed !== null &&
      reconstructed.cursor === params.proof.audit_path.length &&
      reconstructed.oldRootHash === params.oldRootHash &&
      reconstructed.newRootHash === params.newRootHash
    );
  } catch {
    return false;
  }
}

export function assertSha256Hex(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

function assertLeafHashes(leafHashes: string[]): void {
  for (const hash of leafHashes) {
    assertSha256Hex(hash, "leaf hash");
  }
}

function assertTreeSize(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertValidLeafIndex(leafIndex: number, treeSize: number): void {
  assertTreeSize(treeSize, "treeSize");
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= treeSize) {
    throw new Error("leafIndex must address an existing tree leaf");
  }
}

function largestPowerOfTwoLessThan(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 1) {
    throw new Error("value must be a safe integer greater than one");
  }

  let power = 1;
  while (power * 2 < value) {
    power *= 2;
  }
  return power;
}

function merkleRootForRange(
  leafHashes: string[],
  startInclusive: number,
  endExclusive: number,
): string {
  const size = endExclusive - startInclusive;
  if (size <= 0) {
    throw new Error("Merkle range must be non-empty");
  }

  if (size === 1) {
    return leafHashes[startInclusive];
  }

  const split = startInclusive + largestPowerOfTwoLessThan(size);
  return nodeHash(
    merkleRootForRange(leafHashes, startInclusive, split),
    merkleRootForRange(leafHashes, split, endExclusive),
  );
}

function inclusionPathForRange(
  leafIndex: number,
  leafHashes: string[],
  startInclusive: number,
  endExclusive: number,
): MerkleProofStep[] {
  const size = endExclusive - startInclusive;
  if (size === 1) {
    return [];
  }

  const split = startInclusive + largestPowerOfTwoLessThan(size);
  if (leafIndex < split) {
    return [
      ...inclusionPathForRange(leafIndex, leafHashes, startInclusive, split),
      {
        position: "right",
        hash: merkleRootForRange(leafHashes, split, endExclusive),
      },
    ];
  }

  return [
    ...inclusionPathForRange(leafIndex, leafHashes, split, endExclusive),
    {
      position: "left",
      hash: merkleRootForRange(leafHashes, startInclusive, split),
    },
  ];
}

function inclusionPathPositionsForRange(
  leafIndex: number,
  startInclusive: number,
  endExclusive: number,
): Array<MerkleProofStep["position"]> {
  const size = endExclusive - startInclusive;
  if (size === 1) {
    return [];
  }

  const split = startInclusive + largestPowerOfTwoLessThan(size);
  if (leafIndex < split) {
    return [
      ...inclusionPathPositionsForRange(leafIndex, startInclusive, split),
      "right",
    ];
  }

  return [
    ...inclusionPathPositionsForRange(leafIndex, split, endExclusive),
    "left",
  ];
}

function consistencySubproof(
  oldTreeSize: number,
  leafHashes: string[],
  startInclusive: number,
  endExclusive: number,
  includeOldRoot: boolean,
): string[] {
  const newTreeSize = endExclusive - startInclusive;
  if (oldTreeSize === newTreeSize) {
    return includeOldRoot
      ? []
      : [merkleRootForRange(leafHashes, startInclusive, endExclusive)];
  }

  const splitSize = largestPowerOfTwoLessThan(newTreeSize);
  const split = startInclusive + splitSize;

  if (oldTreeSize <= splitSize) {
    return [
      ...consistencySubproof(
        oldTreeSize,
        leafHashes,
        startInclusive,
        split,
        includeOldRoot,
      ),
      merkleRootForRange(leafHashes, split, endExclusive),
    ];
  }

  return [
    ...consistencySubproof(
      oldTreeSize - splitSize,
      leafHashes,
      split,
      endExclusive,
      false,
    ),
    merkleRootForRange(leafHashes, startInclusive, split),
  ];
}

interface ConsistencyVerifierState {
  oldTreeSize: number;
  newTreeSize: number;
  includeOldRoot: boolean;
  auditPath: string[];
  cursor: number;
  oldRootHash: string;
}

interface ConsistencyVerifierResult {
  cursor: number;
  oldRootHash: string;
  newRootHash: string;
}

function verifyConsistencySubproof(
  state: ConsistencyVerifierState,
): ConsistencyVerifierResult | null {
  if (state.oldTreeSize === state.newTreeSize) {
    if (state.includeOldRoot) {
      return {
        cursor: state.cursor,
        oldRootHash: state.oldRootHash,
        newRootHash: state.oldRootHash,
      };
    }

    const rootHash = state.auditPath[state.cursor];
    if (rootHash === undefined) {
      return null;
    }

    return {
      cursor: state.cursor + 1,
      oldRootHash: rootHash,
      newRootHash: rootHash,
    };
  }

  const splitSize = largestPowerOfTwoLessThan(state.newTreeSize);
  if (state.oldTreeSize <= splitSize) {
    const left = verifyConsistencySubproof({
      oldTreeSize: state.oldTreeSize,
      newTreeSize: splitSize,
      includeOldRoot: state.includeOldRoot,
      auditPath: state.auditPath,
      cursor: state.cursor,
      oldRootHash: state.oldRootHash,
    });
    if (left === null) {
      return null;
    }

    const rightHash = state.auditPath[left.cursor];
    if (rightHash === undefined) {
      return null;
    }

    return {
      cursor: left.cursor + 1,
      oldRootHash: left.oldRootHash,
      newRootHash: nodeHash(left.newRootHash, rightHash),
    };
  }

  const right = verifyConsistencySubproof({
    oldTreeSize: state.oldTreeSize - splitSize,
    newTreeSize: state.newTreeSize - splitSize,
    includeOldRoot: false,
    auditPath: state.auditPath,
    cursor: state.cursor,
    oldRootHash: state.oldRootHash,
  });
  if (right === null) {
    return null;
  }

  const leftHash = state.auditPath[right.cursor];
  if (leftHash === undefined) {
    return null;
  }

  return {
    cursor: right.cursor + 1,
    oldRootHash: nodeHash(leftHash, right.oldRootHash),
    newRootHash: nodeHash(leftHash, right.newRootHash),
  };
}
