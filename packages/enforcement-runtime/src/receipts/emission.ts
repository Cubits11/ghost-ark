import {
  buildUnsignedDecisionReceipt,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "./canonical";
import { DecisionReceiptRepository } from "./repository";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";
import { VerifiedIdentityContext } from "../identity/context";
import { ConsentState, PolicyDecision } from "../policy/decisions";

export const DEFAULT_DECISION_RECEIPT_HMAC_SECRET = "ghost-ark-local-decision-receipt-secret";
const KMS_DECISION_RECEIPT_ALGORITHM = "KMS_SIGN_RSASSA_PSS_SHA_256";
const KMS_ALIAS_ARN_PATTERN = /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:alias\/.+$/iu;

export interface DecisionReceiptAsyncSigner {
  readonly keyId: string;
  readonly algorithm: SignedDecisionReceipt["signature_alg"];
  signCanonical(canonicalPayload: string): string | Promise<string>;
}

export interface DecisionReceiptEmissionInput {
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
  previousReceiptHash?: string | null;
  timestamp: string;
}

export interface DecisionReceiptEmitter {
  emit(input: DecisionReceiptEmissionInput): Promise<SignedDecisionReceipt>;
}

export interface DefaultDecisionReceiptEmitterOptions {
  signer: DecisionReceiptAsyncSigner;
  repository?: DecisionReceiptRepository;
  hmacSecret?: string;
}

export class DefaultDecisionReceiptEmitter implements DecisionReceiptEmitter {
  private readonly signer: DecisionReceiptAsyncSigner;
  private readonly repository?: DecisionReceiptRepository;
  private readonly hmacSecret: string;

  constructor(options: DefaultDecisionReceiptEmitterOptions) {
    this.signer = options.signer;
    this.repository = options.repository;
    this.hmacSecret = options.hmacSecret ?? DEFAULT_DECISION_RECEIPT_HMAC_SECRET;
  }

  async emit(input: DecisionReceiptEmissionInput): Promise<SignedDecisionReceipt> {
    const unsigned = buildUnsignedDecisionReceipt({
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
      decision_pre: input.preDecision.decision,
      decision_post: input.postDecision.decision,
      action_taken: [...input.preDecision.actionTaken, ...input.postDecision.actionTaken],
      risk_score: Math.max(input.preDecision.riskScore, input.postDecision.riskScore),
      consent_state: input.consentState,
      memory_written: input.memoryWritten,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      cost_estimate_usd: input.costEstimateUsd ?? 0,
      prev_receipt_hash: input.previousReceiptHash ?? null,
      signature_alg: this.signer.algorithm
    });

    const canonicalPayload = canonicalUnsignedDecisionReceipt(unsigned);
    const signature = await this.signer.signCanonical(canonicalPayload);
    const signatureKeyId = this.signer.keyId;
    if (this.signer.algorithm === KMS_DECISION_RECEIPT_ALGORITHM && isMutableKmsAliasKeyId(signatureKeyId)) {
      throw new Error(`KMS decision receipt signer exposed mutable alias keyId after signing: ${signatureKeyId}`);
    }
    const signed = validateSignedDecisionReceipt({
      ...unsigned,
      receipt_signature: Buffer.from(
        JSON.stringify({
          keyId: signatureKeyId,
          digestSha256: decisionReceiptDigest(unsigned),
          signature
        }),
        "utf8"
      ).toString("base64url")
    });

    await this.repository?.put(signed);
    return signed;
  }
}

function isMutableKmsAliasKeyId(keyId: string): boolean {
  return keyId.startsWith("alias/") || KMS_ALIAS_ARN_PATTERN.test(keyId);
}
