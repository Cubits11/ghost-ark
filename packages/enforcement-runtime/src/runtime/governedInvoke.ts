import { AuthorizationError } from "../../../shared/src/errors";
import { assertModelAllowed } from "../bedrock/modelAllowlist";
import { assertNoClientDeclaredIdentity, resolveVerifiedIdentity, VerifiedIdentityContext } from "../identity/context";
import { compilePolicySet } from "../policy/compiler";
import { evaluatePolicy } from "../policy/evaluator";
import { PolicyDecision } from "../policy/decisions";
import { publicSha256Digest, privateHmacDigest } from "../receipts/canonical";
import { DEFAULT_DECISION_RECEIPT_HMAC_SECRET } from "../receipts/emission";
import { executionTraceFromTransitRecords } from "../receipts/v2/emission";
import { filterRetrievedContext } from "../retrieval/filter";
import { buildPromptContext } from "../retrieval/promptContext";
import { RetrievedContextCandidate } from "../retrieval/types";
import { MemoryWriteResult } from "../vault/store";
import { executionContextHash, normalizeExecutionNonce } from "./executionContext";
import { safeErrorMessage } from "./errors";
import {
  GovernedInvokeDependencies,
  GovernedInvokeRequest,
  isMemoryWriteAllowed,
  isModelInvocationAllowed,
  redactModelOutput,
  statusForBlockingDecision,
  syntheticDecision
} from "./lifecycle";
import { GovernedInvokeMetricName, normalizeModelIdForMetric } from "./metrics";
import { ExecutionNonceReplayError } from "./nonceStore";
import { GovernedInvokeResult, GovernedInvokeStatus } from "./result";

function emptyDecision(phase: PolicyDecision["phase"], policyVersion = "unavailable", policyHash = "0".repeat(64)): PolicyDecision {
  return syntheticDecision({
    phase,
    decision: "REFUSE",
    policyVersion,
    policyHash,
    reason: "runtime failed before policy decision",
    actionTaken: ["fail_closed"],
    riskScore: 1
  });
}

function baseResult(input: {
  requestId: string;
  tenantIdHash: string;
  userIdHash: string;
  modelId: string;
  status: GovernedInvokeStatus;
  preRetrieval?: PolicyDecision;
  preModel: PolicyDecision;
  postModel?: PolicyDecision;
  memoryWrite?: PolicyDecision;
  memory?: Partial<GovernedInvokeResult["memory"]>;
  receipt?: Partial<GovernedInvokeResult["receipt"]>;
  receiptV2?: GovernedInvokeResult["receiptV2"];
  responseText?: string;
  redacted?: boolean;
  errors?: string[];
}): GovernedInvokeResult {
  return {
    schemaVersion: "ghost.governed_invoke.result.v1",
    requestId: input.requestId,
    tenantIdHash: input.tenantIdHash,
    userIdHash: input.userIdHash,
    modelId: input.modelId,
    status: input.status,
    responseText: input.responseText,
    redacted: input.redacted,
    decisionSummary: {
      preRetrieval: input.preRetrieval,
      preModel: input.preModel,
      postModel: input.postModel,
      memoryWrite: input.memoryWrite
    },
    memory: {
      attempted: input.memory?.attempted ?? false,
      written: input.memory?.written ?? false,
      reason: input.memory?.reason ?? "no memory write requested"
    },
    receipt: {
      attempted: input.receipt?.attempted ?? false,
      emitted: input.receipt?.emitted ?? false,
      receiptId: input.receipt?.receiptId,
      failureReason: input.receipt?.failureReason
    },
    ...(input.receiptV2 ? { receiptV2: input.receiptV2 } : {}),
    errors: input.errors ?? []
  };
}

function resolveIdentity(request: GovernedInvokeRequest): VerifiedIdentityContext {
  const identity = resolveVerifiedIdentity({
    authorizer: {
      tenantId: request.auth.tenantId,
      userId: request.auth.userId,
      role: request.auth.role,
      sessionId: request.auth.sessionId,
      requestId: request.auth.requestId,
      source: request.auth.source
    },
    requestId: request.auth.requestId
  });
  if (identity.tenantId !== request.pathTenantId) {
    throw new AuthorizationError("Path tenant does not match authenticated tenant", {
      pathTenantId: request.pathTenantId,
      authTenantId: identity.tenantId
    });
  }
  return identity;
}

function allowedCandidates(candidates: RetrievedContextCandidate[], allowedDigests: string[]): RetrievedContextCandidate[] {
  const allowed = new Set(allowedDigests);
  return candidates.filter((candidate) => allowed.has(candidate.digest));
}

async function emitMetric(
  deps: GovernedInvokeDependencies,
  name: GovernedInvokeMetricName,
  status: string,
  modelId: string
): Promise<void> {
  try {
    await deps.metrics?.emit({
      name,
      dimensions: {
        stage: deps.metricDimensions?.stage ?? "unknown",
        status,
        modelId: normalizeModelIdForMetric(modelId)
      }
    });
  } catch (error) {
    deps.logger?.warn("governed invoke metric emission failed", { error: safeErrorMessage(error), metricName: name });
  }
}

async function finalizeResult(
  deps: GovernedInvokeDependencies,
  result: GovernedInvokeResult,
  extraMetrics: GovernedInvokeMetricName[] = []
): Promise<GovernedInvokeResult> {
  for (const metric of extraMetrics) {
    await emitMetric(deps, metric, result.status, result.modelId);
  }
  if (result.status === "completed") {
    await emitMetric(deps, "GovernedInvokeCompleted", result.status, result.modelId);
  }
  if (result.status === "failed_closed") {
    await emitMetric(deps, "GovernedInvokeFailedClosed", result.status, result.modelId);
  }
  return result;
}

function receiptFailureMetrics(receipt: { emitted: boolean; failureReason?: string }): GovernedInvokeMetricName[] {
  if (receipt.emitted) {
    return [];
  }
  const metrics: GovernedInvokeMetricName[] = ["GovernedInvokeReceiptEmissionFailed"];
  if (/kms|sign/iu.test(receipt.failureReason ?? "")) {
    metrics.push("GovernedInvokeKmsSigningFailed");
  }
  return metrics;
}

function strictRetrievalTaintBlockingEnabled(deps: GovernedInvokeDependencies): boolean {
  return (
    deps.retrievalOptions?.allowTaintedDigestOnly !== true &&
    (deps.retrievalOptions?.rejectCallerSuppliedContexts === true || deps.retrievalOptions?.requireProviderWhenEnabled === true)
  );
}

interface ReceiptV2Outcome {
  attempted: boolean;
  emitted: boolean;
  receiptId?: string;
  failureReason?: string;
}

interface ReceiptEmissionInput {
  deps: GovernedInvokeDependencies;
  identity: VerifiedIdentityContext;
  request: GovernedInvokeRequest;
  inputDigest: string;
  retrievedContextDigests: string[];
  preDecision: PolicyDecision;
  postDecision: PolicyDecision;
  memoryWritten: boolean;
  latencyMs: number;
  costEstimateUsd?: number;
  executionContextHash: string;
  executionNonce: string;
  now: string;
  /**
   * True only on paths reached after deps.modelInvoker.invoke resolved.
   * Model egress that completed with zero gateway-recorded transits must not
   * produce a v2 receipt attesting an empty execution trace.
   */
  modelInvocationSucceeded?: boolean;
}

async function emitReceiptV2Layer(input: ReceiptEmissionInput): Promise<ReceiptV2Outcome | undefined> {
  const emitter = input.deps.receiptEmitterV2;
  if (!emitter) {
    return undefined;
  }
  const transitRecords = input.deps.transitLedger?.records() ?? [];
  if (input.modelInvocationSucceeded && transitRecords.length === 0) {
    return {
      attempted: true,
      emitted: false,
      failureReason:
        "model egress completed outside gateway custody; refusing to emit a v2 receipt attesting an empty execution trace"
    };
  }
  try {
    const receipt = await emitter.emitV2({
      identity: input.identity,
      modelId: input.request.model.modelId,
      policyVersion: input.preDecision.policyVersion,
      policyHash: input.preDecision.policyHash,
      inputDigest: input.inputDigest,
      retrievedContextDigests: input.retrievedContextDigests,
      preDecision: input.preDecision,
      postDecision: input.postDecision,
      memoryWritten: input.memoryWritten,
      consentState: input.request.consentState ?? "missing",
      latencyMs: input.latencyMs,
      costEstimateUsd: input.costEstimateUsd,
      executionContextHash: input.executionContextHash,
      executionNonce: input.executionNonce,
      executionTrace: executionTraceFromTransitRecords(transitRecords),
      timestamp: input.now
    });
    return { attempted: true, emitted: true, receiptId: receipt.receipt_id };
  } catch (error) {
    return { attempted: true, emitted: false, failureReason: safeErrorMessage(error) };
  }
}

async function emitReceipt(
  input: ReceiptEmissionInput
): Promise<
  { emitted: true; receiptId: string; v2?: ReceiptV2Outcome } | { emitted: false; failureReason: string; v2?: ReceiptV2Outcome }
> {
  let receiptId: string;
  try {
    const receipt = await input.deps.receiptEmitter.emit({
      identity: input.identity,
      modelId: input.request.model.modelId,
      policyVersion: input.preDecision.policyVersion,
      policyHash: input.preDecision.policyHash,
      inputDigest: input.inputDigest,
      retrievedContextDigests: input.retrievedContextDigests,
      preDecision: input.preDecision,
      postDecision: input.postDecision,
      memoryWritten: input.memoryWritten,
      consentState: input.request.consentState ?? "missing",
      latencyMs: input.latencyMs,
      costEstimateUsd: input.costEstimateUsd,
      executionContextHash: input.executionContextHash,
      executionNonce: input.executionNonce,
      timestamp: input.now
    });
    receiptId = receipt.receipt_id;
  } catch (error) {
    return {
      emitted: false,
      failureReason: safeErrorMessage(error),
      v2: input.deps.receiptEmitterV2
        ? {
            attempted: false,
            emitted: false,
            failureReason: "v1 receipt emission failed before the v2 layer was attempted"
          }
        : undefined
    };
  }
  const v2 = await emitReceiptV2Layer(input);
  if (!v2) {
    return { emitted: true, receiptId };
  }
  if (v2.emitted) {
    return { emitted: true, receiptId, v2 };
  }
  return { emitted: false, failureReason: v2.failureReason ?? "v2 receipt emission failed", v2 };
}

export async function governedInvoke(
  deps: GovernedInvokeDependencies,
  request: GovernedInvokeRequest
): Promise<GovernedInvokeResult> {
  const now = request.now ?? new Date().toISOString();
  const digestSecret = deps.identityDigestSecret ?? DEFAULT_DECISION_RECEIPT_HMAC_SECRET;
  const requestId = request.auth.requestId ?? "request-unknown";
  const tenantIdHash = request.auth.tenantId ? privateHmacDigest(digestSecret, request.auth.tenantId) : publicSha256Digest("");
  const userIdHash = request.auth.userId ? privateHmacDigest(digestSecret, request.auth.userId) : publicSha256Digest("");
  const sessionIdHash = request.auth.sessionId ? privateHmacDigest(digestSecret, request.auth.sessionId) : publicSha256Digest("");
  const inputDigest = request.input.contentDigest ?? publicSha256Digest(request.input.text);

  let identity: VerifiedIdentityContext;
  try {
    assertNoClientDeclaredIdentity(request.body, { recursive: true });
    identity = resolveIdentity(request);
  } catch (error) {
    deps.logger?.warn("governed invoke identity rejected", { error: safeErrorMessage(error), requestId });
    return finalizeResult(
      deps,
      baseResult({
        requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preModel: emptyDecision("pre_model"),
        errors: [safeErrorMessage(error)]
      })
    );
  }

  let executionNonce: string;
  try {
    executionNonce = normalizeExecutionNonce(request.executionNonce, identity.requestId);
  } catch (error) {
    deps.logger?.warn("governed invoke execution nonce rejected", { error: safeErrorMessage(error), requestId: identity.requestId });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preModel: emptyDecision("pre_model"),
        errors: [safeErrorMessage(error)]
      })
    );
  }

  if (deps.modelAllowlist) {
    try {
      assertModelAllowed(request.model.modelId, deps.modelAllowlist);
    } catch (error) {
      deps.logger?.warn("governed invoke model rejected by allowlist", {
        error: safeErrorMessage(error),
        requestId: identity.requestId,
        modelId: request.model.modelId
      });
      return finalizeResult(
        deps,
        baseResult({
          requestId: identity.requestId,
          tenantIdHash,
          userIdHash,
          modelId: request.model.modelId,
          status: "failed_closed",
          preModel: syntheticDecision({
            phase: "pre_model",
            decision: "REFUSE",
            policyVersion: "unavailable",
            policyHash: "0".repeat(64),
            reason: "model id is not in governed invoke allowlist",
            actionTaken: ["block_model_invocation"],
            riskScore: 1
          }),
          errors: [safeErrorMessage(error)]
        })
      );
    }
  }

  let compiledPolicy;
  try {
    const policies = await deps.policyRepository.loadPolicies({
      tenantId: identity.tenantId,
      userId: identity.userId,
      role: identity.role
    });
    compiledPolicy = compilePolicySet({ policies });
  } catch (error) {
    deps.logger?.error("governed invoke policy load failed", { error: safeErrorMessage(error), requestId: identity.requestId });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preModel: emptyDecision("pre_model"),
        errors: [safeErrorMessage(error)]
      }),
      ["GovernedInvokePolicyLoadFailed"]
    );
  }

  const executionHashFor = (input: {
    retrievedContextDigests: string[];
    preDecision?: PolicyDecision;
    memoryWrite?: GovernedInvokeRequest["memoryWrite"];
  }): string =>
    executionContextHash({
      requestId: identity.requestId,
      tenantIdHash,
      userIdHash,
      sessionIdHash,
      modelId: request.model.modelId,
      policyVersion: compiledPolicy.policyVersion,
      policyHash: compiledPolicy.policyHash,
      inputDigest,
      retrievedContextDigests: input.retrievedContextDigests,
      consentState: request.consentState ?? "missing",
      executionNonce,
      preDecision: input.preDecision
        ? {
            phase: input.preDecision.phase,
            decision: input.preDecision.decision,
            policyVersion: input.preDecision.policyVersion,
            policyHash: input.preDecision.policyHash,
            riskScore: input.preDecision.riskScore
          }
        : undefined,
      memoryWrite: input.memoryWrite
        ? {
            tier: input.memoryWrite.tier,
            contentDigest: input.memoryWrite.contentDigest,
            classificationTags: input.memoryWrite.classificationTags,
            expiresAt: input.memoryWrite.expiresAt
          }
        : undefined
    });

  const preRetrieval = evaluatePolicy(compiledPolicy, {
    phase: "pre_retrieval",
    identity,
    requestText: request.input.text,
    consentState: request.consentState ?? "missing"
  });

  if (!["ALLOW", "RECEIPT_ONLY", "MODIFY", "REDACT"].includes(preRetrieval.decision)) {
    const preModel = syntheticDecision({
      phase: "pre_model",
      decision: preRetrieval.decision,
      policyVersion: compiledPolicy.policyVersion,
      policyHash: compiledPolicy.policyHash,
      reason: "pre-retrieval decision blocked model invocation",
      actionTaken: preRetrieval.actionTaken,
      riskScore: preRetrieval.riskScore
    });
    const receipt = await emitReceipt({
      deps,
      identity,
      request,
      inputDigest,
      retrievedContextDigests: [],
      preDecision: preModel,
      postDecision: preModel,
      memoryWritten: false,
      latencyMs: 0,
      executionContextHash: executionHashFor({ retrievedContextDigests: [], preDecision: preModel, memoryWrite: request.memoryWrite }),
      executionNonce,
      now
    });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: receipt.emitted ? statusForBlockingDecision(preRetrieval.decision, "refused_pre_model") : "failed_closed",
        preRetrieval,
        preModel,
        postModel: preModel,
        receipt: {
          attempted: true,
          emitted: receipt.emitted,
          receiptId: receipt.emitted ? receipt.receiptId : undefined,
          failureReason: receipt.emitted ? undefined : receipt.failureReason
        },
        receiptV2: receipt.v2,
        errors: receipt.emitted ? [] : [receipt.failureReason]
      }),
      receiptFailureMetrics(receipt)
    );
  }

  const callerSuppliedContexts = request.retrieval?.enabled ? request.retrieval.contexts ?? [] : [];
  let requestedContexts: RetrievedContextCandidate[] = [];

  if (request.retrieval?.enabled) {
    if (deps.retrievalOptions?.rejectCallerSuppliedContexts && callerSuppliedContexts.length > 0) {
      const preModel = syntheticDecision({
        phase: "pre_model",
        decision: "REFUSE",
        policyVersion: compiledPolicy.policyVersion,
        policyHash: compiledPolicy.policyHash,
        reason: "caller-supplied retrieval context is not trusted in this runtime mode",
        actionTaken: ["block_model_invocation", "quarantine_retrieval"],
        riskScore: 1
      });
      const receipt = await emitReceipt({
        deps,
        identity,
        request,
        inputDigest,
        retrievedContextDigests: [],
        preDecision: preModel,
        postDecision: preModel,
        memoryWritten: false,
        latencyMs: 0,
        executionContextHash: executionHashFor({ retrievedContextDigests: [], preDecision: preModel, memoryWrite: request.memoryWrite }),
        executionNonce,
        now
      });
      return finalizeResult(
        deps,
        baseResult({
          requestId: identity.requestId,
          tenantIdHash,
          userIdHash,
          modelId: request.model.modelId,
          status: "failed_closed",
          preRetrieval,
          preModel,
          postModel: preModel,
          receipt: {
            attempted: true,
            emitted: receipt.emitted,
            receiptId: receipt.emitted ? receipt.receiptId : undefined,
            failureReason: receipt.emitted ? undefined : receipt.failureReason
          },
          receiptV2: receipt.v2,
          errors: ["caller-supplied retrieval context is not trusted in this runtime mode", ...(receipt.emitted ? [] : [receipt.failureReason])]
        }),
        receiptFailureMetrics(receipt)
      );
    }

    if (deps.retrievalProvider) {
      try {
        requestedContexts = await deps.retrievalProvider.retrieve({
          tenantId: identity.tenantId,
          userId: identity.userId,
          queryText: request.input.text,
          requestId: identity.requestId
        });
        if (!deps.retrievalOptions?.rejectCallerSuppliedContexts) {
          requestedContexts = [...requestedContexts, ...callerSuppliedContexts];
        }
      } catch (error) {
        const preModel = syntheticDecision({
          phase: "pre_model",
          decision: "REFUSE",
          policyVersion: compiledPolicy.policyVersion,
          policyHash: compiledPolicy.policyHash,
          reason: "server-side retrieval provider failed",
          actionTaken: ["fail_closed"],
          riskScore: 1
        });
        const receipt = await emitReceipt({
          deps,
          identity,
          request,
          inputDigest,
          retrievedContextDigests: [],
          preDecision: preModel,
          postDecision: preModel,
          memoryWritten: false,
          latencyMs: 0,
          executionContextHash: executionHashFor({ retrievedContextDigests: [], preDecision: preModel, memoryWrite: request.memoryWrite }),
          executionNonce,
          now
        });
        return finalizeResult(
          deps,
          baseResult({
            requestId: identity.requestId,
            tenantIdHash,
            userIdHash,
            modelId: request.model.modelId,
            status: "failed_closed",
            preRetrieval,
            preModel,
            postModel: preModel,
            receipt: {
              attempted: true,
              emitted: receipt.emitted,
              receiptId: receipt.emitted ? receipt.receiptId : undefined,
              failureReason: receipt.emitted ? undefined : receipt.failureReason
            },
            receiptV2: receipt.v2,
            errors: [safeErrorMessage(error), ...(receipt.emitted ? [] : [receipt.failureReason])]
          }),
          receiptFailureMetrics(receipt)
        );
      }
    } else if (deps.retrievalOptions?.requireProviderWhenEnabled) {
      const preModel = syntheticDecision({
        phase: "pre_model",
        decision: "REFUSE",
        policyVersion: compiledPolicy.policyVersion,
        policyHash: compiledPolicy.policyHash,
        reason: "server-side retrieval provider is required when retrieval is enabled",
        actionTaken: ["block_model_invocation"],
        riskScore: 1
      });
      const receipt = await emitReceipt({
        deps,
        identity,
        request,
        inputDigest,
        retrievedContextDigests: [],
        preDecision: preModel,
        postDecision: preModel,
        memoryWritten: false,
        latencyMs: 0,
        executionContextHash: executionHashFor({ retrievedContextDigests: [], preDecision: preModel, memoryWrite: request.memoryWrite }),
        executionNonce,
        now
      });
      return finalizeResult(
        deps,
        baseResult({
          requestId: identity.requestId,
          tenantIdHash,
          userIdHash,
          modelId: request.model.modelId,
          status: "failed_closed",
          preRetrieval,
          preModel,
          postModel: preModel,
          receipt: {
            attempted: true,
            emitted: receipt.emitted,
            receiptId: receipt.emitted ? receipt.receiptId : undefined,
            failureReason: receipt.emitted ? undefined : receipt.failureReason
          },
          receiptV2: receipt.v2,
          errors: ["server-side retrieval provider is required when retrieval is enabled", ...(receipt.emitted ? [] : [receipt.failureReason])]
        }),
        receiptFailureMetrics(receipt)
      );
    } else {
      requestedContexts = callerSuppliedContexts;
    }
  }

  const retrieval = filterRetrievedContext({
    identityTenantId: identity.tenantId,
    candidates: requestedContexts,
    policyDecision: preRetrieval
  });
  const retrievedContextDigests = retrieval.allowed.map((context) => context.digest).sort();

  if (retrieval.riskTags.includes("retrieval_cross_tenant")) {
    const preModel = syntheticDecision({
      phase: "pre_model",
      decision: "REFUSE",
      policyVersion: compiledPolicy.policyVersion,
      policyHash: compiledPolicy.policyHash,
      reason: "cross-tenant retrieval contamination detected",
      actionTaken: ["block_model_invocation", "quarantine_retrieval"],
      riskScore: 1
    });
    const receipt = await emitReceipt({
      deps,
      identity,
      request,
      inputDigest,
      retrievedContextDigests,
      preDecision: preModel,
      postDecision: preModel,
      memoryWritten: false,
      latencyMs: 0,
      executionContextHash: executionHashFor({ retrievedContextDigests, preDecision: preModel, memoryWrite: request.memoryWrite }),
      executionNonce,
      now
    });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preRetrieval,
        preModel,
        postModel: preModel,
        receipt: {
          attempted: true,
          emitted: receipt.emitted,
          receiptId: receipt.emitted ? receipt.receiptId : undefined,
          failureReason: receipt.emitted ? undefined : receipt.failureReason
        },
        receiptV2: receipt.v2,
        errors: ["cross-tenant retrieval contamination detected", ...(receipt.emitted ? [] : [receipt.failureReason])]
      }),
      ["GovernedInvokeCrossTenantRetrievalBlocked", ...receiptFailureMetrics(receipt)]
    );
  }

  const preModel = evaluatePolicy(compiledPolicy, {
    phase: "pre_model",
    identity,
    requestText: request.input.text,
    riskTags: retrieval.riskTags,
    retrievedContext: retrieval.allowed,
    consentState: request.consentState ?? "missing"
  });

  if (
    retrieval.riskTags.includes("retrieval_untrusted_instruction") &&
    strictRetrievalTaintBlockingEnabled(deps) &&
    isModelInvocationAllowed(preModel)
  ) {
    const strictTaintDecision = syntheticDecision({
      phase: "pre_model",
      decision: "ESCALATE",
      policyVersion: compiledPolicy.policyVersion,
      policyHash: compiledPolicy.policyHash,
      reason: "untrusted retrieval instructions detected before prompt construction",
      actionTaken: ["block_model_invocation", "quarantine_retrieval", "digest_only_receipt"],
      riskScore: 1
    });
    const receipt = await emitReceipt({
      deps,
      identity,
      request,
      inputDigest,
      retrievedContextDigests,
      preDecision: strictTaintDecision,
      postDecision: strictTaintDecision,
      memoryWritten: false,
      latencyMs: 0,
      executionContextHash: executionHashFor({
        retrievedContextDigests,
        preDecision: strictTaintDecision,
        memoryWrite: request.memoryWrite
      }),
      executionNonce,
      now
    });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: receipt.emitted ? statusForBlockingDecision(strictTaintDecision.decision, "refused_pre_model") : "failed_closed",
        preRetrieval,
        preModel: strictTaintDecision,
        postModel: strictTaintDecision,
        receipt: {
          attempted: true,
          emitted: receipt.emitted,
          receiptId: receipt.emitted ? receipt.receiptId : undefined,
          failureReason: receipt.emitted ? undefined : receipt.failureReason
        },
        receiptV2: receipt.v2,
        errors: [
          "untrusted retrieval instructions detected before prompt construction",
          ...(receipt.emitted ? [] : [receipt.failureReason])
        ]
      }),
      receiptFailureMetrics(receipt)
    );
  }

  if (!isModelInvocationAllowed(preModel)) {
    const receipt = await emitReceipt({
      deps,
      identity,
      request,
      inputDigest,
      retrievedContextDigests,
      preDecision: preModel,
      postDecision: preModel,
      memoryWritten: false,
      latencyMs: 0,
      executionContextHash: executionHashFor({ retrievedContextDigests, preDecision: preModel, memoryWrite: request.memoryWrite }),
      executionNonce,
      now
    });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: receipt.emitted ? statusForBlockingDecision(preModel.decision, "refused_pre_model") : "failed_closed",
        preRetrieval,
        preModel,
        postModel: preModel,
        receipt: {
          attempted: true,
          emitted: receipt.emitted,
          receiptId: receipt.emitted ? receipt.receiptId : undefined,
          failureReason: receipt.emitted ? undefined : receipt.failureReason
        },
        receiptV2: receipt.v2,
        errors: receipt.emitted ? [] : [receipt.failureReason]
      }),
      receiptFailureMetrics(receipt)
    );
  }

  const preExecutionContextHash = executionHashFor({
    retrievedContextDigests,
    preDecision: preModel,
    memoryWrite: request.memoryWrite
  });
  if (deps.executionNonceStore) {
    try {
      const reservation = await deps.executionNonceStore.reserve({
        tenantIdHash,
        nonce: executionNonce,
        executionContextHash: preExecutionContextHash,
        requestId: identity.requestId,
        now,
        ttlSeconds: 24 * 60 * 60
      });
      if (reservation === "IDEMPOTENT_REPLAY") {
        const replayDecision = syntheticDecision({
          phase: "pre_model",
          decision: "REFUSE",
          policyVersion: compiledPolicy.policyVersion,
          policyHash: compiledPolicy.policyHash,
          reason: "execution nonce has already been used for this context",
          actionTaken: ["block_replay", "fail_closed"],
          riskScore: 1
        });
        const receipt = await emitReceipt({
          deps,
          identity,
          request,
          inputDigest,
          retrievedContextDigests,
          preDecision: replayDecision,
          postDecision: replayDecision,
          memoryWritten: false,
          latencyMs: 0,
          executionContextHash: preExecutionContextHash,
          executionNonce,
          now
        });
        return finalizeResult(
          deps,
          baseResult({
            requestId: identity.requestId,
            tenantIdHash,
            userIdHash,
            modelId: request.model.modelId,
            status: "failed_closed",
            preRetrieval,
            preModel: replayDecision,
            postModel: replayDecision,
            receipt: {
              attempted: true,
              emitted: receipt.emitted,
              receiptId: receipt.emitted ? receipt.receiptId : undefined,
              failureReason: receipt.emitted ? undefined : receipt.failureReason
            },
            receiptV2: receipt.v2,
            errors: ["execution nonce replay detected", ...(receipt.emitted ? [] : [receipt.failureReason])]
          }),
          receiptFailureMetrics(receipt)
        );
      }
    } catch (error) {
      const replayDecision = syntheticDecision({
        phase: "pre_model",
        decision: "REFUSE",
        policyVersion: compiledPolicy.policyVersion,
        policyHash: compiledPolicy.policyHash,
        reason: error instanceof ExecutionNonceReplayError ? "execution nonce replay detected" : "execution nonce reservation failed",
        actionTaken: ["block_replay", "fail_closed"],
        riskScore: 1
      });
      const receipt = await emitReceipt({
        deps,
        identity,
        request,
        inputDigest,
        retrievedContextDigests,
        preDecision: replayDecision,
        postDecision: replayDecision,
        memoryWritten: false,
        latencyMs: 0,
        executionContextHash: preExecutionContextHash,
        executionNonce,
        now
      });
      return finalizeResult(
        deps,
        baseResult({
          requestId: identity.requestId,
          tenantIdHash,
          userIdHash,
          modelId: request.model.modelId,
          status: "failed_closed",
          preRetrieval,
          preModel: replayDecision,
          postModel: replayDecision,
          receipt: {
            attempted: true,
            emitted: receipt.emitted,
            receiptId: receipt.emitted ? receipt.receiptId : undefined,
            failureReason: receipt.emitted ? undefined : receipt.failureReason
          },
          receiptV2: receipt.v2,
          errors: [safeErrorMessage(error), ...(receipt.emitted ? [] : [receipt.failureReason])]
        }),
        receiptFailureMetrics(receipt)
      );
    }
  }

  let outputText = "";
  let latencyMs = 0;
  let costEstimateUsd = 0;
  try {
    const modelOutput = await deps.modelInvoker.invoke({
      modelId: request.model.modelId,
      prompt: buildPromptContext({
        userText: request.input.text,
        retrieved: allowedCandidates(retrieval.sanitized, retrievedContextDigests)
      }),
      temperature: request.model.temperature,
      maxTokens: request.model.maxTokens,
      requestId: identity.requestId
    });
    outputText = modelOutput.outputText;
    latencyMs = modelOutput.latencyMs;
    costEstimateUsd = modelOutput.costEstimateUsd ?? 0;
  } catch (error) {
    const postModel = syntheticDecision({
      phase: "post_model",
      decision: "REFUSE",
      policyVersion: compiledPolicy.policyVersion,
      policyHash: compiledPolicy.policyHash,
      reason: "model invocation failed",
      actionTaken: ["fail_closed"],
      riskScore: 1
    });
    const receipt = await emitReceipt({
      deps,
      identity,
      request,
      inputDigest,
      retrievedContextDigests,
      preDecision: preModel,
      postDecision: postModel,
      memoryWritten: false,
      latencyMs,
      executionContextHash: preExecutionContextHash,
      executionNonce,
      now
    });
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preRetrieval,
        preModel,
        postModel,
        receipt: {
          attempted: true,
          emitted: receipt.emitted,
          receiptId: receipt.emitted ? receipt.receiptId : undefined,
          failureReason: receipt.emitted ? undefined : receipt.failureReason
        },
        receiptV2: receipt.v2,
        errors: [safeErrorMessage(error), ...(receipt.emitted ? [] : [receipt.failureReason])]
      }),
      ["GovernedInvokeBedrockFailed", ...receiptFailureMetrics(receipt)]
    );
  }

  const postModel = evaluatePolicy(compiledPolicy, {
    phase: "post_model",
    identity,
    requestText: request.input.text,
    outputText,
    riskTags: retrieval.riskTags,
    retrievedContext: retrieval.allowed,
    consentState: request.consentState ?? "missing"
  });

  let status: GovernedInvokeStatus = "completed";
  let responseText: string | undefined = outputText;
  let redacted = false;
  if (postModel.decision === "REDACT") {
    responseText = redactModelOutput(outputText);
    redacted = true;
  } else if (postModel.decision === "REFUSE") {
    status = "refused_post_model";
    responseText = "The governed runtime refused this model output.";
  } else if (postModel.decision === "SILENCE") {
    status = "refused_post_model";
    responseText = undefined;
  } else if (["ESCALATE", "HUMAN_REVIEW", "REQUIRE_CONSENT"].includes(postModel.decision)) {
    status = statusForBlockingDecision(postModel.decision, "refused_post_model");
    responseText = undefined;
  }

  let memoryResult: MemoryWriteResult = { written: false, reason: "no memory write requested" };
  let memoryDecision: PolicyDecision | undefined;
  if (request.memoryWrite) {
    memoryDecision = evaluatePolicy(compiledPolicy, {
      phase: "memory_write",
      identity,
      requestText: request.input.text,
      outputText,
      riskTags: retrieval.riskTags,
      retrievedContext: retrieval.allowed,
      memoryWrite: {
        tier: request.memoryWrite.tier,
        classificationTags: request.memoryWrite.classificationTags,
        contentDigest: request.memoryWrite.contentDigest
      },
      consentState: request.consentState ?? "missing"
    });
    if (postModel.decision === "MEMORY_SUPPRESS") {
      memoryDecision = syntheticDecision({
        phase: "memory_write",
        decision: "MEMORY_SUPPRESS",
        policyVersion: compiledPolicy.policyVersion,
        policyHash: compiledPolicy.policyHash,
        reason: "post-model decision suppressed memory persistence",
        actionTaken: ["drop_memory_write"],
        riskScore: Math.max(postModel.riskScore, memoryDecision.riskScore)
      });
    }

    if (!isMemoryWriteAllowed(memoryDecision)) {
      memoryResult = { written: false, reason: `policy decision ${memoryDecision.decision} prevented persistence` };
    } else {
      try {
        memoryResult = await deps.vaultStore.write(
          {
            tenantId: identity.tenantId,
            userId: identity.userId,
            sessionId: identity.sessionId,
            tier: request.memoryWrite.tier,
            contentDigest: request.memoryWrite.contentDigest,
            classificationTags: request.memoryWrite.classificationTags,
            expiresAt: request.memoryWrite.expiresAt,
            now
          },
          memoryDecision,
          request.consentState ?? "missing"
        );
      } catch (error) {
        const receipt = await emitReceipt({
          deps,
          identity,
          request,
          inputDigest,
          retrievedContextDigests,
          preDecision: preModel,
          postDecision: postModel,
          memoryWritten: false,
          latencyMs,
          costEstimateUsd,
          executionContextHash: preExecutionContextHash,
          executionNonce,
          now,
          modelInvocationSucceeded: true
        });
        return finalizeResult(
          deps,
          baseResult({
            requestId: identity.requestId,
            tenantIdHash,
            userIdHash,
            modelId: request.model.modelId,
            status: "failed_closed",
            preRetrieval,
            preModel,
            postModel,
            memoryWrite: memoryDecision,
            memory: { attempted: true, written: false, reason: safeErrorMessage(error) },
            receipt: {
              attempted: true,
              emitted: receipt.emitted,
              receiptId: receipt.emitted ? receipt.receiptId : undefined,
              failureReason: receipt.emitted ? undefined : receipt.failureReason
            },
            receiptV2: receipt.v2,
            errors: [safeErrorMessage(error), ...(receipt.emitted ? [] : [receipt.failureReason])]
          }),
          receiptFailureMetrics(receipt)
        );
      }
    }
  }

  const receipt = await emitReceipt({
    deps,
    identity,
    request,
    inputDigest,
    retrievedContextDigests,
    preDecision: preModel,
    postDecision: postModel,
    memoryWritten: memoryResult.written,
    latencyMs,
    costEstimateUsd,
    executionContextHash: preExecutionContextHash,
    executionNonce,
    now,
    modelInvocationSucceeded: true
  });

  if (!receipt.emitted) {
    return finalizeResult(
      deps,
      baseResult({
        requestId: identity.requestId,
        tenantIdHash,
        userIdHash,
        modelId: request.model.modelId,
        status: "failed_closed",
        preRetrieval,
        preModel,
        postModel,
        memoryWrite: memoryDecision,
        memory: {
          attempted: Boolean(request.memoryWrite),
          written: memoryResult.written,
          reason: memoryResult.reason
        },
        receipt: { attempted: true, emitted: false, failureReason: receipt.failureReason },
        receiptV2: receipt.v2,
        errors: [receipt.failureReason]
      }),
      [
        ...receiptFailureMetrics(receipt),
        ...(memoryDecision?.decision === "MEMORY_SUPPRESS" ? (["GovernedInvokeMemorySuppressed"] as const) : [])
      ]
    );
  }

  return finalizeResult(
    deps,
    baseResult({
      requestId: identity.requestId,
      tenantIdHash,
      userIdHash,
      modelId: request.model.modelId,
      status,
      responseText,
      redacted,
      preRetrieval,
      preModel,
      postModel,
      memoryWrite: memoryDecision,
      memory: {
        attempted: Boolean(request.memoryWrite),
        written: memoryResult.written,
        reason: memoryResult.reason
      },
      receipt: { attempted: true, emitted: true, receiptId: receipt.receiptId },
      receiptV2: receipt.v2
    }),
    memoryDecision?.decision === "MEMORY_SUPPRESS" ? ["GovernedInvokeMemorySuppressed"] : []
  );
}
