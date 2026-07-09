export type FrontierPhase =
  | "phase_0"
  | "phase_a"
  | "phase_b"
  | "phase_c"
  | "phase_d";

export type ClaimStatus =
  | "not_started"
  | "experimental"
  | "implemented"
  | "verified"
  | "retracted";

export interface FrontierClaim {
  id: string;
  phase: FrontierPhase;
  statement: string;
  status: ClaimStatus;
}

export interface FrontierEvidence {
  id: string;
  type:
    | "test_report"
    | "formal_model"
    | "attestation_manifest"
    | "zk_receipt"
    | "witness_checkpoint"
    | "source_file"
    | "security_review";
  path: string;
  sha256: string;
}

export interface FrontierManifest {
  schema_version: "ghostark.research.frontier_manifest.v1";
  artifact_id: string;
  git_commit: string;
  claims: FrontierClaim[];
  non_claims: string[];
  evidence: FrontierEvidence[];
}

export function assertNoVerifiedClaimWithoutEvidence(
  manifest: FrontierManifest,
): void {
  const verifiedClaims = manifest.claims.filter(
    (claim) => claim.status === "verified",
  );

  if (verifiedClaims.length > 0 && manifest.evidence.length === 0) {
    throw new Error(
      "Invalid frontier manifest: verified claims require evidence.",
    );
  }
}

export function assertNoForbiddenOverclaim(manifest: FrontierManifest): void {
  const phrase = (...parts: string[]): string => parts.join(" ");
  const forbiddenFragments = [
    phrase("proves", "ai", "safety"),
    phrase("guarantees", "model", "safety"),
    phrase("eliminates", "all", "risk"),
    ["un", "breakable"].join(""),
    phrase("fully", "trustless"),
  ];

  const claimText = manifest.claims
    .map((claim) => claim.statement.toLowerCase())
    .join("\n");

  for (const fragment of forbiddenFragments) {
    if (claimText.includes(fragment)) {
      throw new Error(`Forbidden overclaim detected: ${fragment}`);
    }
  }
}

export function validateFrontierManifestSemantics(
  manifest: FrontierManifest,
): void {
  assertNoVerifiedClaimWithoutEvidence(manifest);
  assertNoForbiddenOverclaim(manifest);
}
