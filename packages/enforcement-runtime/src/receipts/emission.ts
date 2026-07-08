import {
  buildUnsignedDecisionReceipt,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "./canonical";
import {
  ChainHeadConflictError,
  DecisionReceiptPersistenceResult,
  DecisionReceiptRepository,
  IntegrityCollisionError
} from "./repository";
import { SignedDecisionReceipt, UnsignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";
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
  executionContextHash?: string;
  executionNonce?: string;
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
    const tenantIdHash = privateHmacDigest(this.hmacSecret, input.identity.tenantId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const previousReceiptHash =
        input.previousReceiptHash !== undefined
          ? input.previousReceiptHash
          : await this.repository?.latestHashForTenant?.({ tenantId: tenantIdHash }) ?? null;
      const unsigned = this.buildUnsigned(input, tenantIdHash, previousReceiptHash);

      const existingReceipt = await this.repository?.get({
        tenantId: unsigned.tenant_id_hash,
        receiptId: unsigned.receipt_id
      });
      if (existingReceipt) {
        const incomingDigest = decisionReceiptDigest(unsigned);
        const storedDigest = decisionReceiptDigest(existingReceipt);
        if (incomingDigest !== storedDigest) {
          throw new IntegrityCollisionError("Receipt replay lookup found mismatched canonical digests", {
            tenantId: unsigned.tenant_id_hash,
            receiptId: unsigned.receipt_id,
            incomingDigest,
            storedDigest
          });
        }
        return existingReceipt;
      }

      const signed = await this.sign(unsigned);
      if (!this.repository) {
        return signed;
      }

      try {
        const persistenceResult = await this.repository.put(signed);
        return receiptFromPersistenceResult(persistenceResult);
      } catch (error) {
        if (
          error instanceof ChainHeadConflictError &&
          input.previousReceiptHash === undefined &&
          this.repository.latestHashForTenant &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ChainHeadConflictError("Receipt chain head kept advancing during receipt emission", {
      tenantId: tenantIdHash,
      requestId: input.identity.requestId
    });
  }

  private buildUnsigned(
    input: DecisionReceiptEmissionInput,
    tenantIdHash: string,
    previousReceiptHash: string | null
  ): UnsignedDecisionReceipt {
    return buildUnsignedDecisionReceipt({
      request_id: input.identity.requestId,
      tenant_id_hash: tenantIdHash,
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
      decision_pre: input.preDecision.decision,
      decision_post: input.postDecision.decision,
      action_taken: [...input.preDecision.actionTaken, ...input.postDecision.actionTaken],
      risk_score: Math.max(input.preDecision.riskScore, input.postDecision.riskScore),
      consent_state: input.consentState,
      memory_written: input.memoryWritten,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      cost_estimate_usd: input.costEstimateUsd ?? 0,
      prev_receipt_hash: previousReceiptHash,
      signature_alg: this.signer.algorithm
    });
  }

  private async sign(unsigned: UnsignedDecisionReceipt): Promise<SignedDecisionReceipt> {
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
    return signed;
  }
}

function receiptFromPersistenceResult(result: DecisionReceiptPersistenceResult): SignedDecisionReceipt {
  switch (result.status) {
    case "CREATED":
    case "IDEMPOTENT_EXISTING":
      return result.receipt;
    default:
      throw new Error(`Unsupported decision receipt persistence status: ${String(result.status)}`);
  }
}

function isMutableKmsAliasKeyId(keyId: string): boolean {
  return keyId.startsWith("alias/") || KMS_ALIAS_ARN_PATTERN.test(keyId);
}
