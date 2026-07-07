import { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../../apps/api/src/lib/auth";
import { assertNoClientDeclaredIdentity } from "../../packages/enforcement-runtime/src/identity/context";

const mocks = vi.hoisted(() => ({
  signReceiptPayload: vi.fn(),
  receiptPut: vi.fn(),
  claimAttachReceipt: vi.fn(),
  lineagePut: vi.fn()
}));

vi.mock("../../packages/shared/src/config", () => ({
  loadRuntimeConfig: () => ({
    stage: "test",
    awsRegion: "us-east-1",
    receiptTableName: "ghost-ark-test-receipts",
    claimTableName: "ghost-ark-test-claims",
    lineageTableName: "ghost-ark-test-lineage",
    signingKeyId: "alias/test"
  })
}));

vi.mock("../../services/signing/kms/signer", () => ({
  signReceiptPayload: mocks.signReceiptPayload
}));

vi.mock("../../services/ledger/dynamodb/data/receiptRepository", () => ({
  ReceiptRepository: vi.fn(function ReceiptRepository() {
    return { put: mocks.receiptPut };
  })
}));

vi.mock("../../services/ledger/dynamodb/data/claimRepository", () => ({
  ClaimRepository: vi.fn(function ClaimRepository() {
    return { attachReceipt: mocks.claimAttachReceipt };
  })
}));

vi.mock("../../services/ledger/dynamodb/data/lineageRepository", () => ({
  LineageRepository: vi.fn(function LineageRepository() {
    return { put: mocks.lineagePut };
  })
}));

import { handler as createReceiptHandler } from "../../apps/api/src/handlers/createReceipt";

function parsedBody(response: { body?: string }): unknown {
  return JSON.parse(response.body ?? "{}");
}

function authenticatedEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    headers: {},
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: "user-a",
          "custom:tenant_slug": "tenant-a"
        }
      }
    }
  } as unknown as APIGatewayProxyEventV2;
}

describe("tenant boundary security invariants", () => {
  beforeEach(() => {
    mocks.signReceiptPayload.mockReset();
    mocks.receiptPut.mockReset();
    mocks.claimAttachReceipt.mockReset();
    mocks.lineagePut.mockReset();
  });

  it("does not accept developer headers as tenant authority", () => {
    const event = {
      headers: { "x-tenant-slug": "tenant-a", "x-principal-subject": "user-a" },
      requestContext: {}
    } as unknown as APIGatewayProxyEventV2;

    expect(() => authenticate(event)).toThrow(/Missing tenant identity/u);
  });

  it("rejects client-declared tenant, user, or session identifiers", () => {
    expect(() => assertNoClientDeclaredIdentity({ tenant_id: "tenant-b", prompt: "hello" })).toThrow(
      /Client-declared tenant/u
    );
    expect(() => assertNoClientDeclaredIdentity({ userId: "user-b" })).toThrow(/Client-declared tenant/u);
    expect(() => assertNoClientDeclaredIdentity({ safe: true })).not.toThrow();
  });

  it("rejects receipt creation when the body supplies a tenant override", async () => {
    const response = await createReceiptHandler(
      authenticatedEvent({
        tenant_id: "tenant-b",
        subject: { kind: "dataset-version", id: "dataset-a" },
        evidenceObjects: ["ev_1"],
        governanceContext: {
          lakeFormationTags: { tenant_slug: "tenant-a" },
          columnRestrictions: [],
          policyCompilerVersion: "50.0.0"
        }
      })
    );

    expect(response.statusCode).toBe(400);
    expect(parsedBody(response)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mocks.signReceiptPayload).not.toHaveBeenCalled();
    expect(mocks.receiptPut).not.toHaveBeenCalled();
  });
});
