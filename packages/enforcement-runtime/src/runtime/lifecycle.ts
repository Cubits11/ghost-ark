import { Logger } from "../../../shared/src/logger";
import { VerifiedIdentityContext } from "../identity/context";
import { ConsentState, DecisionKind, EnforcementPhase, PolicyDecision } from "../policy/decisions";
import { PolicyRepository } from "../policy/repository";
import { PolicyMemoryTier } from "../policy/schema";
import { RetrievedContextCandidate } from "../retrieval/types";
import { RetrievalProvider } from "../retrieval/types";
import { DecisionReceiptEmitter } from "../receipts/emission";
import { DecisionReceiptV2Emitter } from "../receipts/v2/runtimeEmitter";
import { VaultStore } from "../vault/store";
import { ModelInvoker } from "../bedrock/types";
import { GovernedInvokeStatus } from "./result";
import { GovernedInvokeMetrics } from "./metrics";
import { ExecutionNonceStore } from "./nonceStore";
import { TransitLedger } from "./transitLedger";

export interface GovernedInvokeRequest {
  pathTenantId: string;
  body: unknown;
  auth: {
    tenantId: string;
    userId: string;
    role?: string;
    sessionId?: string;
    requestId?: string;
    source: "jwt" | "authorizer" | "cognito" | "lambda-authorizer";
  };
  model: {
    modelId: string;
    temperature?: number;
    maxTokens?: number;
  };
  input: {
    text: string;
    contentDigest?: string;
  };
  retrieval?: {
    enabled: boolean;
    contexts?: RetrievedContextCandidate[];
  };
  memoryWrite?: {
    tier: PolicyMemoryTier;
    contentDigest: string;
    classificationTags: string[];
    expiresAt?: string;
  };
  consentState?: ConsentState;
  executionNonce?: string;
  now?: string;
}

export interface GovernedInvokeDependencies {
  policyRepository: PolicyRepository;
  modelInvoker: ModelInvoker;
  vaultStore: VaultStore;
  receiptEmitter: DecisionReceiptEmitter;
  logger?: Logger;
  identityDigestSecret?: string;
  modelAllowlist?: string[];
  retrievalProvider?: RetrievalProvider;
  retrievalOptions?: {
    rejectCallerSuppliedContexts?: boolean;
    requireProviderWhenEnabled?: boolean;
    allowTaintedDigestOnly?: boolean;
  };
  metrics?: GovernedInvokeMetrics;
  metricDimensions?: {
    stage?: string;
  };
  executionNonceStore?: ExecutionNonceStore;
  /**
   * Optional v2 receipt layer. When configured, every receipt-bearing path
   * also emits a ghost.receipt.v2 whose execution_trace is the transit
   * ledger's gateway-recorded custody; a completed model invocation with zero
   * recorded transits fails closed instead of attesting an empty trace.
   * When absent, behavior is unchanged from the v1-only runtime.
   */
  receiptEmitterV2?: DecisionReceiptV2Emitter;
  transitLedger?: TransitLedger;
}

export function isModelInvocationAllowed(decision: PolicyDecision): boolean {
  return ["ALLOW", "RECEIPT_ONLY", "MODIFY"].includes(decision.decision);
}

export function isMemoryWriteAllowed(decision: PolicyDecision): boolean {
  return ["ALLOW", "RECEIPT_ONLY", "MODIFY", "REDACT"].includes(decision.decision);
}

export function statusForBlockingDecision(decision: DecisionKind, fallback: GovernedInvokeStatus): GovernedInvokeStatus {
  if (decision === "REQUIRE_CONSENT") {
    return "requires_consent";
  }
  if (decision === "ESCALATE") {
    return "escalated";
  }
  if (decision === "HUMAN_REVIEW") {
    return "human_review";
  }
  if (decision === "REFUSE" || decision === "SILENCE") {
    return fallback;
  }
  return "failed_closed";
}

export function syntheticDecision(input: {
  phase: EnforcementPhase;
  decision: DecisionKind;
  policyVersion: string;
  policyHash: string;
  reason: string;
  actionTaken?: string[];
  riskScore?: number;
}): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase: input.phase,
    decision: input.decision,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: input.actionTaken ?? [],
    riskScore: input.riskScore ?? 1,
    reasons: [input.reason]
  };
}

export function redactModelOutput(output: string): string {
  return output
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/gu, "[REDACTED_PHONE]")
    .replace(/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[^"'\s]+/giu, "[REDACTED_SECRET]");
}
