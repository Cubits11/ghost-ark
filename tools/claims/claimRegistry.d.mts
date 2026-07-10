export const CLAIM_REGISTRY_SCHEMA_VERSION: string;

export interface ClaimCitation {
  path: string;
  expect_sha256: string;
  supports_level: number;
}

export interface Claim {
  id: string;
  statement: string;
  asserts_level: number;
  cites: ClaimCitation[];
}

export interface ClaimCheckResult {
  id: string;
  ok: boolean;
  asserts_level: number | null;
  supported_level: number;
  reasons: string[];
}

export interface ClaimRegistry {
  schema_version: string;
  description?: string;
  claims: Claim[];
}

export function computeArtifactDigest(absolutePath: string): string;
export function checkClaim(claim: unknown, rootDir?: string): ClaimCheckResult;
export function checkRegistry(registry: unknown, rootDir?: string): ClaimCheckResult[];
export function main(argv?: string[]): number;
