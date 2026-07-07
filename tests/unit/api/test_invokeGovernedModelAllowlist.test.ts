import { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler } from "../../../apps/api/src/handlers/invokeGoverned";

const originalEnv = { ...process.env };

function event(modelId: string): APIGatewayProxyEventV2 {
  return {
    headers: {},
    pathParameters: { tenantSlug: "tenant-a" },
    body: JSON.stringify({
      model: { modelId, temperature: 0, maxTokens: 16 },
      input: { text: "hello" },
      consentState: "not_required"
    }),
    requestContext: {
      requestId: "request-a",
      authorizer: {
        claims: {
          sub: "user-a",
          "custom:tenant_slug": "tenant-a"
        }
      }
    }
  } as unknown as APIGatewayProxyEventV2;
}

describe("invokeGoverned handler model allowlist", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STAGE: "test",
      GHOST_ARK_MODEL_MODE: "fake",
      GHOST_ARK_RECEIPT_SIGNER: "local",
      GHOST_ARK_POLICY_REPOSITORY: "in_memory",
      GHOST_ARK_VAULT: "in_memory",
      GHOST_ARK_DECISION_RECEIPT_REPOSITORY: "in_memory",
      GHOST_ARK_BEDROCK_MODEL_ALLOWLIST: "anthropic.allowed-model",
      GHOST_ARK_FAKE_MODEL_OUTPUT: "allowed output"
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects an unallowlisted model before model invocation completes", async () => {
    const response = await handler(event("anthropic.blocked-model"));
    const body = JSON.parse(response.body ?? "{}") as { status?: string; responseText?: string };

    expect(response.statusCode).toBe(403);
    expect(body.status).toBe("failed_closed");
    expect(body.responseText).toBeUndefined();
  });

  it("allows a configured model id", async () => {
    const response = await handler(event("anthropic.allowed-model"));
    const body = JSON.parse(response.body ?? "{}") as { status?: string; responseText?: string };

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.responseText).toBe("allowed output");
  });
});
