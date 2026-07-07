import { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  receiptGet: vi.fn(),
  claimsList: vi.fn()
}));

vi.mock("../../../packages/shared/src/config", () => ({
  loadRuntimeConfig: () => ({
    receiptTableName: "ghost-ark-test-receipts",
    claimTableName: "ghost-ark-test-claims",
    lineageTableName: "ghost-ark-test-lineage",
    signingKeyId: "alias/test"
  })
}));

vi.mock("../../../services/ledger/dynamodb/data/receiptRepository", () => ({
  ReceiptRepository: vi.fn(function ReceiptRepository() {
    return {
      get: mocks.receiptGet
    };
  })
}));

vi.mock("../../../services/ledger/dynamodb/data/claimRepository", () => ({
  ClaimRepository: vi.fn(function ClaimRepository() {
    return {
      list: mocks.claimsList
    };
  })
}));

import { handler as getReceiptHandler } from "../../../apps/api/src/handlers/getReceipt";
import { handler as listClaimsHandler } from "../../../apps/api/src/handlers/listClaims";

function eventWithTenantPath(options: {
  identityTenant: string;
  pathTenant?: string;
  receiptId?: string;
  queryStringParameters?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  return {
    headers: {},
    pathParameters: {
      ...(options.pathTenant ? { tenantSlug: options.pathTenant } : {}),
      ...(options.receiptId ? { receiptId: options.receiptId } : {})
    },
    queryStringParameters: options.queryStringParameters,
    requestContext: {
      authorizer: {
        claims: {
          sub: "user-123",
          "custom:tenant_slug": options.identityTenant,
          "cognito:groups": "auditor"
        }
      }
    }
  } as unknown as APIGatewayProxyEventV2;
}

function parsedBody(response: { body?: string }): unknown {
  return JSON.parse(response.body ?? "{}");
}

describe("API tenant boundary", () => {
  beforeEach(() => {
    mocks.receiptGet.mockReset();
    mocks.claimsList.mockReset();
  });

  it("rejects receipt retrieval when path tenant differs from identity tenant", async () => {
    const response = await getReceiptHandler(
      eventWithTenantPath({
        identityTenant: "acme-lab",
        pathTenant: "beta-lab",
        receiptId: "rct_abc"
      })
    );

    expect(response.statusCode).toBe(403);
    expect(parsedBody(response)).toMatchObject({
      error: {
        code: "AUTHORIZATION_ERROR"
      }
    });
    expect(mocks.receiptGet).not.toHaveBeenCalled();
  });

  it("allows receipt retrieval when path tenant matches identity tenant", async () => {
    const record = {
      payload: {
        receiptId: "rct_abc",
        tenantSlug: "acme-lab"
      },
      status: "issued"
    };

    mocks.receiptGet.mockResolvedValue(record);

    const response = await getReceiptHandler(
      eventWithTenantPath({
        identityTenant: "acme-lab",
        pathTenant: "acme-lab",
        receiptId: "rct_abc"
      })
    );

    expect(response.statusCode).toBe(200);
    expect(parsedBody(response)).toEqual(record);
    expect(mocks.receiptGet).toHaveBeenCalledWith("acme-lab", "rct_abc");
  });

  it("rejects claim listing when path tenant differs from identity tenant", async () => {
    const response = await listClaimsHandler(
      eventWithTenantPath({
        identityTenant: "acme-lab",
        pathTenant: "beta-lab"
      })
    );

    expect(response.statusCode).toBe(403);
    expect(parsedBody(response)).toMatchObject({
      error: {
        code: "AUTHORIZATION_ERROR"
      }
    });
    expect(mocks.claimsList).not.toHaveBeenCalled();
  });

  it("allows claim listing when path tenant matches identity tenant", async () => {
    mocks.claimsList.mockResolvedValue([]);

    const response = await listClaimsHandler(
      eventWithTenantPath({
        identityTenant: "acme-lab",
        pathTenant: "acme-lab"
      })
    );

    expect(response.statusCode).toBe(200);
    expect(parsedBody(response)).toEqual({ claims: [] });
    expect(mocks.claimsList).toHaveBeenCalledWith("acme-lab", undefined, 100);
  });

  it("uses bounded state and limit parameters only after tenant boundary passes", async () => {
    mocks.claimsList.mockResolvedValue([]);

    const response = await listClaimsHandler(
      eventWithTenantPath({
        identityTenant: "acme-lab",
        pathTenant: "acme-lab",
        queryStringParameters: {
          state: "accepted",
          limit: "7"
        }
      })
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.claimsList).toHaveBeenCalledWith("acme-lab", "accepted", 7);
  });
});
