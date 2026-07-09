import {
  buildUnsignedDecisionReceipt,
  canonicalUnsignedDecisionReceipt,
  decisionReceiptDigest,
  privateHmacDigest,
  publicSha256Digest
} from "./canonical";
import { encodeDecisionReceiptSignatureEnvelope } from "./signer";
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
const SHA256_OR_HMAC_DIGEST_PATTERN = /^(sha256|hmac-sha256):[a-f0-9]{64}$/u;

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
    assertSigner(options.signer);

    this.signer = options.signer;
    this.repository = options.repository;
    this.hmacSecret = options.hmacSecret ?? DEFAULT_DECISION_RECEIPT_HMAC_SECRET;

    if (this.hmacSecret.length === 0) {
      throw new Error("Decision receipt HMAC secret must be non-empty.");
    }
  }

  async emit(input: DecisionReceiptEmissionInput): Promise<SignedDecisionReceipt> {
    assertEmissionInput(input);

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

    assertSignatureShape(signature);

    if (this.signer.algorithm === KMS_DECISION_RECEIPT_ALGORITHM && isMutableKmsAliasKeyId(signatureKeyId)) {
      throw new Error(`KMS decision receipt signer exposed mutable alias keyId after signing: ${signatureKeyId}`);
    }

    return validateSignedDecisionReceipt({
      ...unsigned,
      receipt_signature: encodeDecisionReceiptSignatureEnvelope({
        schemaVersion: "ghost.decision_receipt_signature.v1",
        keyId: signatureKeyId,
        algorithm: this.signer.algorithm,
        digestSha256: decisionReceiptDigest(unsigned),
        signature
      })
    });
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

function assertSigner(signer: DecisionReceiptAsyncSigner): void {
  if (!signer || typeof signer !== "object") {
    throw new Error("Decision receipt signer must be an object.");
  }

  if (typeof signer.keyId !== "string" || signer.keyId.length === 0) {
    throw new Error("Decision receipt signer keyId must be non-empty.");
  }

  if (
    signer.algorithm !== "LOCAL_HMAC_SHA256_DEV_ONLY" &&
    signer.algorithm !== "KMS_SIGN_RSASSA_PSS_SHA_256"
  ) {
    throw new Error(`Unsupported decision receipt signer algorithm: ${String(signer.algorithm)}`);
  }

  if (typeof signer.signCanonical !== "function") {
    throw new Error("Decision receipt signer must expose signCanonical().");
  }
}

function assertEmissionInput(input: DecisionReceiptEmissionInput): void {
  assertNonEmpty("identity.tenantId", input.identity.tenantId);
  assertNonEmpty("identity.userId", input.identity.userId);
  assertNonEmpty("identity.sessionId", input.identity.sessionId);
  assertNonEmpty("identity.requestId", input.identity.requestId);
  assertNonEmpty("modelId", input.modelId);
  assertNonEmpty("policyVersion", input.policyVersion);
  assertNonEmpty("policyHash", input.policyHash);
  assertNonEmpty("timestamp", input.timestamp);

  if (!Number.isFinite(Date.parse(input.timestamp))) {
    throw new Error(`Decision receipt timestamp is not parseable: ${input.timestamp}`);
  }

  if (input.inputDigest && !SHA256_OR_HMAC_DIGEST_PATTERN.test(input.inputDigest)) {
    throw new Error(`Decision receipt inputDigest is malformed: ${input.inputDigest}`);
  }

  for (const digest of input.retrievedContextDigests) {
    if (!SHA256_OR_HMAC_DIGEST_PATTERN.test(digest)) {
      throw new Error(`Decision receipt retrieved context digest is malformed: ${digest}`);
    }
  }

  if (!Number.isFinite(input.latencyMs)) {
    throw new Error("Decision receipt latencyMs must be finite.");
  }

  if (input.costEstimateUsd !== undefined && (!Number.isFinite(input.costEstimateUsd) || input.costEstimateUsd < 0)) {
    throw new Error("Decision receipt costEstimateUsd must be a non-negative finite number when supplied.");
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Decision receipt ${name} must be a non-empty string.`);
  }
}

function assertSignatureShape(signature: string): void {
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Decision receipt signer returned an empty signature.");
  }

  const decoded = Buffer.from(signature, "base64");
  if (decoded.length === 0) {
    throw new Error("Decision receipt signer returned a signature that decodes to empty bytes.");
  }
}

function isMutableKmsAliasKeyId(keyId: string): boolean {
  return keyId.startsWith("alias/") || KMS_ALIAS_ARN_PATTERN.test(keyId);
}