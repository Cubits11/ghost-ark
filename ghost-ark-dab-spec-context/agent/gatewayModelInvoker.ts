import { canonicalize } from "../../../receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../shared/src/errors";
import { ModelInvokeInput, ModelInvokeOutput, ModelInvoker } from "../bedrock/types";
import { TransitLedger } from "../runtime/transitLedger";
import { executeGovernedTransit } from "./sidecarProxy";

/**
 * ModelInvoker that routes model egress through the sidecar transit boundary.
 *
 * The runtime never opens its own socket to the model endpoint: the request
 * bytes are canonicalized, transmitted by executeGovernedTransit under an
 * exact-match destination allowlist, and the observed transit is recorded in
 * the per-invocation TransitLedger. The recorded digests are the gateway's
 * account of what crossed the wire; the model's account is never consulted.
 *
 * Custody is recorded before the response is interpreted: a transit whose
 * body fails to parse is still a recorded egress, so the subsequent
 * fail-closed receipt binds the real transit digests.
 *
 * This is a local reference implementation against an HTTP model endpoint.
 * It carries no Bedrock, deployment, or isolation claim: host code that
 * bypasses this invoker is outside the boundary and is handled by the
 * unrecorded-egress refusal in governedInvoke.
 */

export interface GatewayBoundModelInvokerOptions {
  targetUrl: string;
  /** Exact-match "host:port" entries. Empty list means every destination is refused. */
  allowedDestinations: readonly string[];
  ledger: TransitLedger;
  toolName?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function invokerError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.gateway_model_invoker.v1", ...context });
}

export class GatewayBoundModelInvoker implements ModelInvoker {
  private readonly options: GatewayBoundModelInvokerOptions;

  constructor(options: GatewayBoundModelInvokerOptions) {
    this.options = options;
  }

  async invoke(input: ModelInvokeInput): Promise<ModelInvokeOutput> {
    const payload: Record<string, unknown> = {
      modelId: input.modelId,
      prompt: input.prompt,
      requestId: input.requestId
    };
    if (input.temperature !== undefined) {
      payload.temperature = input.temperature;
    }
    if (input.maxTokens !== undefined) {
      payload.maxTokens = input.maxTokens;
    }
    const requestBody = Buffer.from(canonicalize(payload), "utf8");

    const sequenceNum = this.options.ledger.nextSequenceNum();
    const startedAtMs = Date.now();
    const record = await executeGovernedTransit({
      targetUrl: this.options.targetUrl,
      toolName: this.options.toolName ?? "model_invoke",
      requestBody,
      sequenceNum,
      allowedDestinations: this.options.allowedDestinations,
      timeoutMs: this.options.timeoutMs,
      maxResponseBytes: this.options.maxResponseBytes
    });
    const latencyMs = Date.now() - startedAtMs;

    this.options.ledger.record(record);

    if (record.statusCode !== 200) {
      throw invokerError("Model endpoint returned a non-200 status; failing closed without fabricating output.", {
        statusCode: record.statusCode
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(record.body.toString("utf8"));
    } catch {
      throw invokerError("Model endpoint response was not valid JSON; failing closed without fabricating output.");
    }
    const outputText = (parsed as { outputText?: unknown })?.outputText;
    if (typeof outputText !== "string") {
      throw invokerError("Model endpoint response did not carry a string outputText field.");
    }
    const costEstimateUsd = (parsed as { costEstimateUsd?: unknown })?.costEstimateUsd;

    return {
      outputText,
      rawOutputDigest: record.responseDigest,
      latencyMs,
      costEstimateUsd:
        typeof costEstimateUsd === "number" && Number.isFinite(costEstimateUsd) && costEstimateUsd >= 0
          ? costEstimateUsd
          : 0
    };
  }
}
