import { describe, expect, it } from "vitest";
import { FakeModelInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { PolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/repository";
import { InMemoryPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { DefaultDecisionReceiptEmitter, DecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { governedInvoke } from "../../../../packages/enforcement-runtime/src/runtime/governedInvoke";
import { GovernedInvokeDependencies, GovernedInvokeRequest } from "../../../../packages/enforcement-runtime/src/runtime/lifecycle";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";

function request(overrides: Partial<GovernedInvokeRequest> = {}): GovernedInvokeRequest {
  return {
    pathTenantId: "tenant-a",
    body: { input: { text: "hello" } },
    auth: {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionId: "session-a",
      requestId: "request-a",
      source: "jwt"
    },
    model: { modelId: "anthropic.claude-test" },
    input: { text: "hello" },
    consentState: "not_required",
    now: "2026-07-07T12:00:00.000Z",
    ...overrides
  };
}

function deps(options: { policyRepository?: PolicyRepository; receiptEmitter?: DecisionReceiptEmitter; fake?: FakeModelInvoker } = {}) {
  const fake = options.fake ?? new FakeModelInvoker({ outputText: "ok" });
  const receipts = new InMemoryDecisionReceiptRepository();
  const receiptEmitter =
    options.receiptEmitter ??
    new DefaultDecisionReceiptEmitter({
      signer: new LocalDevHmacReceiptSigner({ secret: "local-secret" }),
      repository: receipts,
      hmacSecret: "identity-secret"
    });
  return {
    policyRepository: options.policyRepository ?? new InMemoryPolicyRepository(),
    modelInvoker: fake,
    vaultStore: new InMemoryVaultStore(),
    receiptEmitter,
    identityDigestSecret: "identity-secret",
    fake,
    receipts
  } satisfies GovernedInvokeDependencies & { fake: FakeModelInvoker; receipts: InMemoryDecisionReceiptRepository };
}

describe("governedInvoke fail-closed behavior", () => {
  it("fails closed on path/auth tenant mismatch without invoking the model", async () => {
    const runtime = deps();
    const result = await governedInvoke(runtime, request({ pathTenantId: "tenant-b" }));

    expect(result.status).toBe("failed_closed");
    expect(runtime.fake.called).toBe(false);
    expect(result.receipt.attempted).toBe(false);
  });

  it("rejects body-declared tenant authority before model invocation", async () => {
    const runtime = deps();
    const result = await governedInvoke(runtime, request({ body: { tenantId: "evil", input: { text: "hello" } } }));

    expect(result.status).toBe("failed_closed");
    expect(runtime.fake.called).toBe(false);
    expect(result.errors[0]).toMatch(/Client-declared tenant/u);
  });

  it("rejects nested client-declared identity before model invocation", async () => {
    const runtime = deps();
    const result = await governedInvoke(runtime, request({ body: { input: { text: "hello", userId: "evil" } } }));

    expect(result.status).toBe("failed_closed");
    expect(runtime.fake.called).toBe(false);
    expect(result.errors[0]).toMatch(/Client-declared tenant/u);
  });

  it("fails closed when the policy repository throws", async () => {
    const runtime = deps({
      policyRepository: {
        async loadPolicies() {
          throw new Error("policy table unavailable");
        }
      }
    });
    const result = await governedInvoke(runtime, request());

    expect(result.status).toBe("failed_closed");
    expect(runtime.fake.called).toBe(false);
    expect(result.errors[0]).toMatch(/policy table unavailable/u);
  });

  it("fails closed on cross-tenant retrieval contamination", async () => {
    const runtime = deps();
    const result = await governedInvoke(
      runtime,
      request({
        retrieval: {
          enabled: true,
          contexts: [
            {
              tenantId: "tenant-b",
              digest: "sha256:" + "d".repeat(64),
              text: "tenant B private context",
              taint: ["trusted"]
            }
          ]
        }
      })
    );

    expect(result.status).toBe("failed_closed");
    expect(runtime.fake.called).toBe(false);
    expect(result.errors.join(" ")).toMatch(/cross-tenant retrieval/u);
    expect(result.receipt.attempted).toBe(true);
  });

  it("fails closed when receipt emission fails after model output", async () => {
    const runtime = deps({
      receiptEmitter: {
        async emit() {
          throw new Error("signer unavailable");
        }
      }
    });
    const result = await governedInvoke(runtime, request());

    expect(runtime.fake.called).toBe(true);
    expect(result.status).toBe("failed_closed");
    expect(result.responseText).toBeUndefined();
    expect(result.receipt).toMatchObject({ attempted: true, emitted: false, failureReason: "signer unavailable" });
  });

  it("converts model adapter invocation failures into failed_closed with a receipt attempt", async () => {
    const runtime = deps({
      fake: new FakeModelInvoker({ error: new Error("Unsupported Bedrock model family for governed invoke adapter") })
    });
    const result = await governedInvoke(runtime, request());

    expect(runtime.fake.called).toBe(true);
    expect(result.status).toBe("failed_closed");
    expect(result.responseText).toBeUndefined();
    expect(result.errors.join(" ")).toMatch(/Unsupported Bedrock model family/u);
    expect(result.receipt.attempted).toBe(true);
  });
});
