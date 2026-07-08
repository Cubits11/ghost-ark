import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { PolicyDecision } from "../policy/decisions";
import { PolicyMemoryTier } from "../policy/schema";

export interface ExecutionContextSnapshot {
  requestId: string;
  tenantIdHash: string;
  userIdHash: string;
  sessionIdHash: string;
  modelId: string;
  policyVersion: string;
  policyHash: string;
  inputDigest: string;
  retrievedContextDigests: string[];
  consentState: string;
  executionNonce: string;
  preDecision?: Pick<PolicyDecision, "decision" | "phase" | "policyHash" | "policyVersion" | "riskScore">;
  memoryWrite?: {
    tier: PolicyMemoryTier;
    contentDigest: string;
    classificationTags: string[];
    expiresAt?: string;
  };
}

export function normalizeExecutionNonce(value: string | undefined, requestId: string): string {
  const nonce = (value ?? requestId).trim();
  if (!/^[A-Za-z0-9._:-]{8,256}$/u.test(nonce)) {
    throw new Error("Execution nonce must be 8-256 characters of URL-safe text");
  }
  return nonce;
}

export function executionContextHash(snapshot: ExecutionContextSnapshot): string {
  const canonicalSnapshot = {
    schemaVersion: "ghost.execution_context.v1",
    requestId: snapshot.requestId,
    tenantIdHash: snapshot.tenantIdHash,
    userIdHash: snapshot.userIdHash,
    sessionIdHash: snapshot.sessionIdHash,
    modelId: snapshot.modelId,
    policyVersion: snapshot.policyVersion,
    policyHash: snapshot.policyHash,
    inputDigest: snapshot.inputDigest,
    retrievedContextDigests: [...snapshot.retrievedContextDigests].sort(),
    consentState: snapshot.consentState,
    executionNonce: snapshot.executionNonce,
    ...(snapshot.preDecision ? { preDecision: snapshot.preDecision } : {}),
    ...(snapshot.memoryWrite
      ? {
          memoryWrite: {
            tier: snapshot.memoryWrite.tier,
            contentDigest: snapshot.memoryWrite.contentDigest,
            classificationTags: [...snapshot.memoryWrite.classificationTags].sort(),
            ...(snapshot.memoryWrite.expiresAt ? { expiresAt: snapshot.memoryWrite.expiresAt } : {})
          }
        }
      : {})
  };
  return `sha256:${canonicalSha256Hex(canonicalSnapshot)}`;
}
