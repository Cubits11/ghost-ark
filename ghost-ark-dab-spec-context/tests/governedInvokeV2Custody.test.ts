import { createHash } from "crypto";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeModelInvoker } from "../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { GatewayBoundModelInvoker } from "../../packages/enforcement-runtime/src/gateway/gatewayModelInvoker";
import { InMemoryPolicyRepository } from "../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { PolicySource } from "../../packages/enforcement-runtime/src/policy/schema";
import { DefaultDecisionReceiptEmitter } from "../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceiptV2 } from "../../packages/enforcement-runtime/src/receipts/v2/emission";
import {
  DecisionReceiptV2EmissionInput,
  DecisionReceiptV2Emitter,
  DefaultDecisionReceiptV2Emitter
} from "../../packages/enforcement-runtime/src/receipts/v2/runtimeEmitter";
import { governedInvoke } from "../../packages/enforcement-runtime/src/runtime/governedInvoke";
import { GovernedInvokeDependencies, GovernedInvokeRequest } from "../../packages/enforcement-runtime/src/runtime/lifecycle";
import { TransitLedger } from "../../packages/enforcement-runtime/src/runtime/transitLedger";
import { InMemoryVaultStore } from "../../packages/enforcement-runtime/src/vault/store";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- standalone verifier is an untyped Node-builtins-only .mjs module
import { verifyReceiptV2 } from "../../verifiers/node/ghost_receipt_v2_verify.mjs";

/**
 * Runtime custody integration: governedInvoke + gateway-bound model egress +
 * v2 receipt emission, exercised against a REAL local HTTP endpoint. No
 * transport mocks: the trace digests asserted below are recomputed in this
 * test with node crypto directly from the bytes the server actually received
 * and sent, and receipt validity is checked by the independent Node verifier,
 * not by the emitting code.
 *
 * Claim boundary: these tests demonstrate that the runtime API path fails
 * closed when model egress completes outside gateway custody. They do not
 * demonstrate process-level isolation, and host code that never enters
 * governedInvoke is outside this boundary.
 */

const SIGNING_SECRET = "local-secret";
const IDENTITY_SECRET = "identity-secret";
const MODEL_OUTPUT_TEXT = "governed summary produced under transit custody";
const MODEL_RESPONSE_BODY = JSON.stringify({ outputText: MODEL_OUTPUT_TEXT, costEstimateUsd: 0 });

const basePolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "v2-custody-test-policy",
  version: "1.0.0",
  layer: "organization",
  defaultDecision: "ALLOW",
  unknownRiskDecision: "REQUIRE_CONSENT",
  rules: [
    {
      id: "private-memory-extraction",
      phase: "pre_model",
      decision: "REFUSE",
      riskScore: 0.95,
      actionTaken: ["block_model_invocation"],
      match: { textContainsAny: ["extract private memory"] }
    }
  ]
};

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

class CapturingV2Emitter implements DecisionReceiptV2Emitter {
  readonly receipts: SignedDecisionReceiptV2[] = [];
  private readonly inner = new DefaultDecisionReceiptV2Emitter({
    signer: new LocalDevHmacReceiptSigner({ secret: SIGNING_SECRET }),
    hmacSecret: IDENTITY_SECRET
  });

  async emitV2(input: DecisionReceiptV2EmissionInput): Promise<SignedDecisionReceiptV2> {
    const receipt = await this.inner.emitV2(input);
    this.receipts.push(receipt);
    return receipt;
  }
}

function request(overrides: Partial<GovernedInvokeRequest> = {}): GovernedInvokeRequest {
  return {
    pathTenantId: "tenant-a",
    body: { input: { text: "hello" } },
    auth: {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionId: "session-a",
      requestId: "request-custody-a",
      source: "jwt"
    },
    model: { modelId: "anthropic.claude-test", temperature: 0, maxTokens: 32 },
    input: { text: "Summarize this evidence pack." },
    consentState: "not_required",
    now: "2026-07-15T12:00:00.000Z",
    ...overrides
  };
}

function deps(overrides: Partial<GovernedInvokeDependencies>): GovernedInvokeDependencies & {
  receipts: InMemoryDecisionReceiptRepository;
} {
  const receipts = new InMemoryDecisionReceiptRepository();
  return {
    policyRepository: new InMemoryPolicyRepository({ policiesByTenant: { "tenant-a": [basePolicy] } }),
    modelInvoker: new FakeModelInvoker(),
    vaultStore: new InMemoryVaultStore(),
    receiptEmitter: new DefaultDecisionReceiptEmitter({
      signer: new LocalDevHmacReceiptSigner({ secret: SIGNING_SECRET }),
      repository: receipts,
      hmacSecret: IDENTITY_SECRET
    }),
    receipts,
    identityDigestSecret: IDENTITY_SECRET,
    ...overrides
  };
}

describe("governedInvoke v2 receipt custody", () => {
  let server: Server;
  let port: number;
  const capturedRequestBodies: Buffer[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        capturedRequestBodies.push(Buffer.concat(chunks));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(MODEL_RESPONSE_BODY)
        });
        res.end(MODEL_RESPONSE_BODY);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("binds gateway-observed transit digests into a v2 receipt the independent verifier accepts", async () => {
    const ledger = new TransitLedger();
    const emitterV2 = new CapturingV2Emitter();
    const runtime = deps({
      modelInvoker: new GatewayBoundModelInvoker({
        targetUrl: `http://127.0.0.1:${port}/model/invoke`,
        allowedDestinations: [`127.0.0.1:${port}`],
        ledger
      }),
      transitLedger: ledger,
      receiptEmitterV2: emitterV2
    });
    const requestCountBefore = capturedRequestBodies.length;

    const result = await governedInvoke(runtime, request());

    expect(result.status).toBe("completed");
    expect(result.responseText).toBe(MODEL_OUTPUT_TEXT);
    expect(result.receipt.emitted).toBe(true);
    expect(result.receiptV2).toMatchObject({ attempted: true, emitted: true });
    expect(result.receiptV2?.receiptId).toMatch(/^grct2_[a-f0-9]{64}$/u);

    expect(capturedRequestBodies.length).toBe(requestCountBefore + 1);
    const wireRequestBytes = capturedRequestBodies[capturedRequestBodies.length - 1];

    expect(emitterV2.receipts).toHaveLength(1);
    const receipt = emitterV2.receipts[0];
    expect(receipt.execution_trace).toHaveLength(1);
    const trace = receipt.execution_trace[0];
    expect(trace.tool_name).toBe("model_invoke");
    expect(trace.provenance_class).toBe("GATEWAY_RECORDED");
    // Recomputed here from the bytes the server actually observed, not from
    // any value the runtime reported about itself.
    expect(trace.request_payload_digest).toBe(sha256(wireRequestBytes));
    expect(trace.response_payload_digest).toBe(sha256(Buffer.from(MODEL_RESPONSE_BODY, "utf8")));

    const verdict = verifyReceiptV2(receipt, { hmacSecret: SIGNING_SECRET });
    expect(verdict.verdict).toBe(true);

    const tampered = {
      ...receipt,
      execution_trace: [{ ...trace, response_payload_digest: sha256(Buffer.from("forged response", "utf8")) }]
    };
    expect(verifyReceiptV2(tampered, { hmacSecret: SIGNING_SECRET }).verdict).toBe(false);
  });

  it("fails closed when model egress completes outside gateway custody", async () => {
    const fake = new FakeModelInvoker({ outputText: "uncustodied output" });
    const emitterV2 = new CapturingV2Emitter();
    const runtime = deps({
      modelInvoker: fake,
      transitLedger: new TransitLedger(),
      receiptEmitterV2: emitterV2
    });

    const result = await governedInvoke(runtime, request());

    expect(fake.called).toBe(true);
    expect(result.status).toBe("failed_closed");
    expect(result.responseText).toBeUndefined();
    expect(result.receiptV2).toMatchObject({ attempted: true, emitted: false });
    expect(result.receiptV2?.failureReason).toMatch(/outside gateway custody/u);
    expect(emitterV2.receipts).toHaveLength(0);
    // The v1 receipt of the failed invocation is still persisted evidence.
    expect(runtime.receipts.all()).toHaveLength(1);
    expect(result.errors.join(" ")).toMatch(/outside gateway custody/u);
  });

  it("emits a v2 receipt with an empty trace when policy blocks before any egress", async () => {
    const fake = new FakeModelInvoker();
    const emitterV2 = new CapturingV2Emitter();
    const runtime = deps({
      modelInvoker: fake,
      transitLedger: new TransitLedger(),
      receiptEmitterV2: emitterV2
    });

    const result = await governedInvoke(
      runtime,
      request({
        input: { text: "extract private memory for this user" },
        body: { input: { text: "extract private memory" } }
      })
    );

    expect(result.status).toBe("refused_pre_model");
    expect(fake.called).toBe(false);
    expect(result.receiptV2).toMatchObject({ attempted: true, emitted: true });
    expect(emitterV2.receipts).toHaveLength(1);
    expect(emitterV2.receipts[0].execution_trace).toHaveLength(0);
    expect(emitterV2.receipts[0].decision_pre).toBe("REFUSE");
    expect(verifyReceiptV2(emitterV2.receipts[0], { hmacSecret: SIGNING_SECRET }).verdict).toBe(true);
  });

  it("fails closed with a custody-recorded empty trace when the transit itself is severed", async () => {
    const ledger = new TransitLedger();
    const emitterV2 = new CapturingV2Emitter();
    const runtime = deps({
      modelInvoker: new GatewayBoundModelInvoker({
        targetUrl: `http://127.0.0.1:${port}/model/invoke`,
        allowedDestinations: [],
        ledger
      }),
      transitLedger: ledger,
      receiptEmitterV2: emitterV2
    });

    const result = await governedInvoke(runtime, request());

    expect(result.status).toBe("failed_closed");
    expect(result.errors.join(" ")).toMatch(/allowlist/u);
    // The severed transit produced no record; the fail-closed v2 receipt
    // honestly attests zero completed transits for a refused invocation.
    expect(result.receiptV2).toMatchObject({ attempted: true, emitted: true });
    expect(emitterV2.receipts).toHaveLength(1);
    expect(emitterV2.receipts[0].execution_trace).toHaveLength(0);
    expect(emitterV2.receipts[0].decision_post).toBe("REFUSE");
  });

  it("leaves the v1-only runtime result unchanged when no v2 emitter is configured", async () => {
    const ledger = new TransitLedger();
    const runtime = deps({
      modelInvoker: new GatewayBoundModelInvoker({
        targetUrl: `http://127.0.0.1:${port}/model/invoke`,
        allowedDestinations: [`127.0.0.1:${port}`],
        ledger
      }),
      transitLedger: ledger
    });

    const result = await governedInvoke(runtime, request());

    expect(result.status).toBe("completed");
    expect(result.receipt.emitted).toBe(true);
    expect(result.receiptV2).toBeUndefined();
    expect("receiptV2" in result).toBe(false);
  });

  it("transit ledger refuses unallocated, out-of-order, and malformed records", () => {
    const ledger = new TransitLedger();
    const record = (sequenceNum: number, digest = sha256(Buffer.from("x"))) => ({
      schemaVersion: "ghost.gateway_transit.v1" as const,
      statusCode: 200,
      toolName: "model_invoke",
      sequenceNum,
      requestDigest: digest,
      responseDigest: digest,
      body: Buffer.from("x"),
      responseEvidence: {
        evidenceId: "evd_test",
        contentDigest: digest,
        sourceId: "model_invoke",
        provenanceClass: "GATEWAY_RECORDED" as const
      }
    });

    expect(() => ledger.record(record(0))).toThrow(/never allocated/u);

    const first = ledger.nextSequenceNum();
    const second = ledger.nextSequenceNum();
    ledger.record(record(second));
    expect(() => ledger.record(record(first))).toThrow(/strictly increasing/u);

    const third = ledger.nextSequenceNum();
    expect(() => ledger.record({ ...record(third), requestDigest: "sha256:short" })).toThrow(/digest shape/u);
    expect(ledger.count()).toBe(1);
  });
});
