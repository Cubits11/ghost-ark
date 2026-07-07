import { describe, expect, it } from "vitest";
import { FakeModelInvoker } from "../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { InMemoryPolicyRepository } from "../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { DefaultDecisionReceiptEmitter } from "../../packages/enforcement-runtime/src/receipts/emission";
import { InMemoryDecisionReceiptRepository } from "../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner } from "../../packages/enforcement-runtime/src/receipts/signer";
import { governedInvoke } from "../../packages/enforcement-runtime/src/runtime/governedInvoke";
import { InMemoryVaultStore } from "../../packages/enforcement-runtime/src/vault/store";

function deps(fake: FakeModelInvoker) {
  return {
    policyRepository: new InMemoryPolicyRepository(),
    modelInvoker: fake,
    vaultStore: new InMemoryVaultStore(),
    receiptEmitter: new DefaultDecisionReceiptEmitter({
      signer: new LocalDevHmacReceiptSigner({ secret: "local-secret" }),
      repository: new InMemoryDecisionReceiptRepository(),
      hmacSecret: "identity-secret"
    }),
    identityDigestSecret: "identity-secret"
  };
}

describe("governed invoke tenant boundary", () => {
  it("does not let path, body, or retrieval content override authenticated tenant authority", async () => {
    const fake = new FakeModelInvoker({ outputText: "ok" });
    const result = await governedInvoke(deps(fake), {
      pathTenantId: "tenant-a",
      body: { tenant_id: "tenant-b", input: { text: "hello" } },
      auth: {
        tenantId: "tenant-a",
        userId: "user-a",
        sessionId: "session-a",
        requestId: "request-a",
        source: "jwt"
      },
      model: { modelId: "anthropic.claude-test" },
      input: { text: "hello" },
      retrieval: {
        enabled: true,
        contexts: [
          {
            tenantId: "tenant-b",
            digest: "sha256:" + "a".repeat(64),
            text: "tenant b data",
            taint: ["trusted"]
          }
        ]
      },
      consentState: "not_required",
      now: "2026-07-07T12:00:00.000Z"
    });

    expect(result.status).toBe("failed_closed");
    expect(result.errors[0]).toMatch(/Client-declared tenant/u);
    expect(fake.called).toBe(false);
  });
});
