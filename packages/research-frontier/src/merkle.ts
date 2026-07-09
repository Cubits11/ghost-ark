import { createHash } from "crypto";

export const EMPTY_TREE_ROOT = createHash("sha256")
  .update("ghostark.empty_merkle_tree.v1")
  .digest("hex");

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

  let level = [...leafHashes];

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      // Odd levels duplicate the final leaf for this local research primitive.
      const right = level[i + 1] ?? level[i];
      nextLevel.push(nodeHash(left, right));
    }

    level = nextLevel;
  }

  return level[0];
}

export function computeMerkleRoot(payloads: string[]): string {
  return computeMerkleRootFromLeafHashes(payloads.map(leafHash));
}

export function assertSha256Hex(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}
