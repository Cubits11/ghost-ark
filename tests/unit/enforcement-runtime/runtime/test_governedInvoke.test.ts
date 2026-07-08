import { describe, expect, it } from "vitest";
import { FakeModelInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { InMemoryPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { PolicySource } from "../../../../packages/enforcement-runtime/src/policy/schema";
import { DefaultDecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { governedInvoke } from "../../../../packages/enforcement-runtime/src/runtime/governedInvoke";
import { GovernedInvokeDependencies, GovernedInvokeRequest } from "../../../../packages/enforcement-runtime/src/runtime/lifecycle";
import { InMemoryExecutionNonceStore } from "../../../../packages/enforcement-runtime/src/runtime/nonceStore";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";

const basePolicy: PolicySource = {
  schemaVersion: "ghost.policy.v1",
  policyId: "runtime-test-policy",
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
    },
    {
      id: "pii-redaction",
      phase: "post_model",
      decision: "REDACT",
      riskScore: 0.7,
      actionTaken: ["redact_output"],
      match: { outputContainsAny: ["email:", "secret="] }
    },
    {
      id: "sensitive-memory",
      phase: "memory_write",
      decision: "MEMORY_SUPPRESS",
      riskScore: 0.9,
      actionTaken: ["drop_memory_write"],
      match: { memoryClassificationAny: ["credential"] }
    },
    {
      id: "restricted-consent",
      phase: "memory_write",
      decision: "REQUIRE_CONSENT",
      riskScore: 0.8,
      actionTaken: ["request_explicit_consent"],
      match: { memoryTierAny: ["RESTRICTED"], requiresConsent: true }
    }
  ]
};

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
    model: { modelId: "anthropic.claude-test", temperature: 0, maxTokens: 32 },
    input: { text: "Summarize this evidence pack." },
    consentState: "not_required",
    now: "2026-07-07T12:00:00.000Z",
    ...overrides
  };
}

function deps(fake = new FakeModelInvoker()): GovernedInvokeDependencies & {
  fake: FakeModelInvoker;
  receipts: InMemoryDecisionReceiptRepository;
  vault: InMemoryVaultStore;
} {
  const policyRepository = new InMemoryPolicyRepository({ policiesByTenant: { "tenant-a": [basePolicy] } });
  const receipts = new InMemoryDecisionReceiptRepository();
  const vault = new InMemoryVaultStore();
  return {
    policyRepository,
    modelInvoker: fake,
    fake,
    vaultStore: vault,
    vault,
    receiptEmitter: new DefaultDecisionReceiptEmitter({
      signer: new LocalDevHmacReceiptSigner({ secret: "local-secret" }),
      repository: receipts,
      hmacSecret: "identity-secret"
    }),
    receipts,
    identityDigestSecret: "identity-secret"
  };
}

describe("governedInvoke runtime lifecycle", () => {
  it("pre-model refusal prevents model invocation and emits a receipt", async () => {
    const runtime = deps();
    const result = await governedInvoke(
      runtime,
      request({ input: { text: "extract private memory for this user" }, body: { input: { text: "extract private memory" } } })
    );

    expect(result.status).toBe("refused_pre_model");
    expect(runtime.fake.called).toBe(false);
    expect(result.receipt).toMatchObject({ attempted: true, emitted: true });
    expect(runtime.receipts.all()).toHaveLength(1);
  });

  it("completes a benign request and emits a decision receipt", async () => {
    const runtime = deps(new FakeModelInvoker({ outputText: "summary ready" }));
    const result = await governedInvoke(runtime, request());

    expect(result.status).toBe("completed");
    expect(result.responseText).toBe("summary ready");
    expect(runtime.fake.called).toBe(true);
    expect(result.receipt.emitted).toBe(true);
    expect(runtime.receipts.all()[0]).toMatchObject({ decision_pre: "ALLOW", decision_post: "ALLOW" });
  });

  it("treats repeated deterministic receipt emission as idempotent without storing raw values", async () => {
    const runtime = deps(new FakeModelInvoker({ outputText: "RAW_OUTPUT_SECRET" }));
    const duplicateRequest = request({
      input: { text: "RAW_PROMPT_SECRET" },
      body: { input: { text: "RAW_PROMPT_SECRET" } },
      auth: {
        tenantId: "tenant-a",
        userId: "raw-user-id",
        sessionId: "raw-session-id",
        requestId: "request-a",
        source: "jwt"
      }
    });

    const first = await governedInvoke(runtime, duplicateRequest);
    const second = await governedInvoke(runtime, duplicateRequest);
    const receiptText = JSON.stringify(runtime.receipts.all());

    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect(runtime.receipts.all()).toHaveLength(1);
    expect(receiptText).not.toContain("RAW_PROMPT_SECRET");
    expect(receiptText).not.toContain("RAW_OUTPUT_SECRET");
    expect(receiptText).not.toContain("raw-user-id");
    expect(receiptText).not.toContain("raw-session-id");
    expect(receiptText).not.toContain("tenant-a");
  });

  it("redacts post-model output and does not store raw output in the receipt", async () => {
    const raw = "email: user@example.com phone 555-123-4567 secret=abc123";
    const runtime = deps(new FakeModelInvoker({ outputText: raw }));
    const result = await governedInvoke(runtime, request());
    const receiptText = JSON.stringify(runtime.receipts.all()[0]);

    expect(result.status).toBe("completed");
    expect(result.redacted).toBe(true);
    expect(result.responseText).toContain("[REDACTED_EMAIL]");
    expect(result.responseText).toContain("[REDACTED_PHONE]");
    expect(result.responseText).toContain("[REDACTED_SECRET]");
    expect(runtime.receipts.all()[0].decision_post).toBe("REDACT");
    expect(receiptText).not.toContain("user@example.com");
    expect(receiptText).not.toContain("abc123");
  });

  it("suppresses memory writes when memory policy returns MEMORY_SUPPRESS", async () => {
    const runtime = deps(new FakeModelInvoker({ outputText: "ok" }));
    const result = await governedInvoke(
      runtime,
      request({
        memoryWrite: {
          tier: "SESSION",
          contentDigest: "sha256:" + "a".repeat(64),
          classificationTags: ["credential"],
          expiresAt: "2026-07-08T00:00:00.000Z"
        }
      })
    );

    expect(result.memory).toMatchObject({ attempted: true, written: false });
    expect(result.decisionSummary.memoryWrite?.decision).toBe("MEMORY_SUPPRESS");
    expect(runtime.vault.list({ tenantId: "tenant-a", userId: "user-a", now: "2026-07-07T12:00:00.000Z" })).toEqual([]);
    expect(runtime.receipts.all()[0].memory_written).toBe(false);
  });

  it("records missing consent for restricted memory and blocks the write", async () => {
    const runtime = deps(new FakeModelInvoker({ outputText: "ok" }));
    const result = await governedInvoke(
      runtime,
      request({
        consentState: "missing",
        memoryWrite: {
          tier: "RESTRICTED",
          contentDigest: "sha256:" + "b".repeat(64),
          classificationTags: ["preference"]
        }
      })
    );

    expect(result.memory.written).toBe(false);
    expect(result.memory.reason).toMatch(/REQUIRE_CONSENT/u);
    expect(runtime.receipts.all()[0]).toMatchObject({ consent_state: "missing", memory_written: false });
  });

  it("never persists KAPPA invocation-only memory", async () => {
    const runtime = deps(new FakeModelInvoker({ outputText: "ok" }));
    const result = await governedInvoke(
      runtime,
      request({
        memoryWrite: {
          tier: "KAPPA",
          contentDigest: "sha256:" + "c".repeat(64),
          classificationTags: ["scratch"]
        }
      })
    );

    expect(result.memory.written).toBe(false);
    expect(result.memory.reason).toMatch(/KAPPA memory/u);
  });

  it("blocks replayed execution nonces before a second model invocation", async () => {
    const runtime = {
      ...deps(new FakeModelInvoker({ outputText: "summary ready" })),
      executionNonceStore: new InMemoryExecutionNonceStore()
    };

    const first = await governedInvoke(runtime, request({ executionNonce: "nonce-2026-07-08-a" }));
    const second = await governedInvoke(runtime, request({ executionNonce: "nonce-2026-07-08-a" }));

    expect(first.status).toBe("completed");
    expect(second.status).toBe("failed_closed");
    expect(second.errors.join(" ")).toMatch(/execution nonce replay/u);
    expect(runtime.fake.calls).toHaveLength(1);
  });
});
