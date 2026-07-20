import { createHash } from "crypto";

export interface ReadSetEntry {
  key: string;
  digestSha256: string;
}

export interface OCCGateInput {
  trajectoryId: string;
  forkReadSet: Record<string, string>;
  commitReadSet: Record<string, string>;
}

export interface OCCGateResult {
  admitted: boolean;
  forkProjectionHash: string;
  commitProjectionHash: string;
  conflictingKeys: string[];
  reason?: string;
}

export function computeReadSetProjectionHash(readSet: Record<string, string>): string {
  const sortedKeys = Object.keys(readSet).sort();
  const serialized = sortedKeys.map((k) => `${k}:${readSet[k]}`).join(";");
  return createHash("sha256").update(serialized).digest("hex");
}

export function evaluateOCCGate(input: OCCGateInput): OCCGateResult {
  const forkProjectionHash = computeReadSetProjectionHash(input.forkReadSet);
  const commitProjectionHash = computeReadSetProjectionHash(input.commitReadSet);

  const conflictingKeys: string[] = [];
  const allKeys = new Set([...Object.keys(input.forkReadSet), ...Object.keys(input.commitReadSet)]);

  for (const k of allKeys) {
    if (input.forkReadSet[k] !== input.commitReadSet[k]) {
      conflictingKeys.push(k);
    }
  }

  const admitted = forkProjectionHash === commitProjectionHash;

  return {
    admitted,
    forkProjectionHash,
    commitProjectionHash,
    conflictingKeys,
    ...(admitted ? {} : { reason: `OCC read-set projection conflict on keys: ${conflictingKeys.join(", ")}` })
  };
}
