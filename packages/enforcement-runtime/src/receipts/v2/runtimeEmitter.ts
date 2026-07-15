import { VerifiedIdentityContext } from "../../identity/context";
import { ConsentState, PolicyDecision } from "../../policy/decisions";
import { privateHmacDigest, publicSha256Digest } from "../canonical";
import { DEFAULT_DECISION_RECEIPT_HMAC_SECRET } from "../emission";
import { DecisionReceiptSigner } from "../signer";
import {
  buildUnsignedDecisionReceiptV2,
  DecisionReceiptV2TraceEntry,
  signDecisionReceiptV2,
  SignedDecisionReceiptV2
} from "./emission";

/**
 * Runtime-facing v2 receipt emitter (DRAFT, additive).
 *
 * Mirrors the v1 DefaultDecisionReceiptEmitter's identity hashing and field
 * derivation so that a v2 receipt emitted for the same invocation carries the
 * same v1-visible values, and reuses the v2 build/sign path unchanged — no
 * canonicalization or signing logic is re-implemented here.
 *
 * Deliberate v2-prototype limits, stated rather than hidden:
 * - prev_receipt_hash is null: v2 receipts are not chain-linked yet,
 * - there is no v2 repository; persistence is the caller's concern,
 * - the signer is the synchronous DecisionReceiptSigner (local HMAC is
 *   dev-only; async KMS custody for v2 is not wired here).
 */

export interface DecisionReceiptV2EmissionInput {
  identity: VerifiedIdentityContext;
  modelId: string;
  policyVersion: string;
  policyHash: string;
  inputDigest: string;
  retrievedContextDigests: string[];
  preDecision: PolicyDecision;
  postDecision: PolicyDecision;
  memoryWritten: boolean;
  consentState: ConsentState;
  latencyMs: number;
  costEstimateUsd?: number;
  executionContextHash: string;
  executionNonce: string;
  executionTrace: DecisionReceiptV2TraceEntry[];
  timestamp: string;
}

export interface DecisionReceiptV2Emitter {
  emitV2(input: DecisionReceiptV2EmissionInput): Promise<SignedDecisionReceiptV2>;
}

export interface DefaultDecisionReceiptV2EmitterOptions {
  signer: DecisionReceiptSigner;
  hmacSecret?: string;
}

export class DefaultDecisionReceiptV2Emitter implements DecisionReceiptV2Emitter {
  private readonly signer: DecisionReceiptSigner;
  private readonly hmacSecret: string;

  constructor(options: DefaultDecisionReceiptV2EmitterOptions) {
    this.signer = options.signer;
    this.hmacSecret = options.hmacSecret ?? DEFAULT_DECISION_RECEIPT_HMAC_SECRET;
    if (this.hmacSecret.length === 0) {
      throw new Error("Decision receipt v2 HMAC secret must be non-empty.");
    }
  }

  async emitV2(input: DecisionReceiptV2EmissionInput): Promise<SignedDecisionReceiptV2> {
    const unsigned = buildUnsignedDecisionReceiptV2({
      request_id: input.identity.requestId,
      tenant_id_hash: privateHmacDigest(this.hmacSecret, input.identity.tenantId),
      user_id_hash: privateHmacDigest(this.hmacSecret, input.identity.userId),
      session_id_hash: privateHmacDigest(this.hmacSecret, input.identity.sessionId),
      timestamp: input.timestamp,
      model_id: input.modelId,
      policy_version: input.policyVersion,
      policy_hash: input.policyHash,
      input_digest: input.inputDigest || publicSha256Digest(""),
      retrieved_context_digests: input.retrievedContextDigests,
      execution_context_hash: input.executionContextHash,
      execution_nonce: input.executionNonce,
      execution_trace: input.executionTrace,
      decision_pre: input.preDecision.decision,
      decision_post: input.postDecision.decision,
      action_taken: [...input.preDecision.actionTaken, ...input.postDecision.actionTaken],
      risk_score: Math.max(input.preDecision.riskScore, input.postDecision.riskScore),
      consent_state: input.consentState,
      memory_written: input.memoryWritten,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      cost_estimate_usd: input.costEstimateUsd ?? 0,
      prev_receipt_hash: null,
      signature_alg: this.signer.algorithm
    });
    return signDecisionReceiptV2(unsigned, this.signer);
  }
}
