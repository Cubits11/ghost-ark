import { AuthorizationError } from "../../../shared/src/errors";
import { assertModelAllowed } from "../bedrock/modelAllowlist";
import { assertNoClientDeclaredIdentity, resolveVerifiedIdentity, VerifiedIdentityContext } from "../identity/context";
import { compilePolicySet } from "../policy/compiler";
import { evaluatePolicy } from "../policy/evaluator";
import { PolicyDecision } from "../policy/decisions";
import { publicSha256Digest, privateHmacDigest } from "../receipts/canonical";
import { DEFAULT_DECISION_RECEIPT_HMAC_SECRET } from "../receipts/emission";
import { filterRetrievedContext } from "../retrieval/filter";
import { buildPromptContext } from "../retrieval/promptContext";
import { RetrievedContextCandidate } from "../retrieval/types";
import { MemoryWriteResult } from "../vault/store";
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

async function emitReceipt(input: {
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
  now: string;
}): Promise<{ emitted: true; receiptId: string } | { emitted: false; failureReason: string }> {
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
      timestamp: input.now
    });
    return { emitted: true, receiptId: receipt.receipt_id };
  } catch (error) {
    return { emitted: false, failureReason: safeErrorMessage(error) };
  }
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
        errors: receipt.emitted ? [] : [receipt.failureReason]
      }),
      receiptFailureMetrics(receipt)
    );
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
            memoryWrite: memoryDecision,
            memory: { attempted: true, written: false, reason: safeErrorMessage(error) },
            receipt: {
              attempted: true,
              emitted: receipt.emitted,
              receiptId: receipt.emitted ? receipt.receiptId : undefined,
              failureReason: receipt.emitted ? undefined : receipt.failureReason
            },
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
    now
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
      receipt: { attempted: true, emitted: true, receiptId: receipt.receiptId }
    }),
    memoryDecision?.decision === "MEMORY_SUPPRESS" ? ["GovernedInvokeMemorySuppressed"] : []
  );
}
