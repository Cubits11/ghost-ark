export interface ConsistencyResult {
  consistent: boolean;
  mismatches: string[];
}

export function checkEvidenceConsistency(
  localDigests: Record<string, string>,
  cloudDigests: Record<string, string>
): ConsistencyResult {
  const mismatches: string[] = [];

  for (const [id, localHash] of Object.entries(localDigests)) {
    const cloudHash = cloudDigests[id];
    if (!cloudHash) {
      mismatches.push(`Missing cloud evidence: ${id}`);
    } else if (localHash !== cloudHash) {
      mismatches.push(`Digest mismatch for ${id}: local ${localHash} vs cloud ${cloudHash}`);
    }
  }

  return {
    consistent: mismatches.length === 0,
    mismatches
  };
}
