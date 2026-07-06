import { describe, expect, it } from "vitest";
import { APIGatewayProxyEventV2 } from "aws-lambda";
import { authenticate } from "../../../apps/api/src/lib/auth";

function eventWithAuthorizer(authorizer: Record<string, unknown>): APIGatewayProxyEventV2 {
  return {
    headers: {},
    requestContext: { authorizer }
  } as unknown as APIGatewayProxyEventV2;
}

describe("API authorizer context", () => {
  it("extracts Cognito REST API claims from requestContext.authorizer", () => {
    const principal = authenticate(
      eventWithAuthorizer({
        claims: {
          sub: "user-123",
          "custom:tenant_slug": "acme-lab",
          "cognito:groups": "auditor operator"
        }
      })
    );

    expect(principal).toEqual({
      subject: "user-123",
      tenantSlug: "acme-lab",
      roles: ["auditor", "operator"],
      source: "jwt"
    });
  });

  it("extracts Lambda authorizer tenant context", () => {
    const principal = authenticate(
      eventWithAuthorizer({
        principalId: "tenant-service-role",
        tenant_slug: "example-tenant",
        roles: "operator"
      })
    );

    expect(principal).toEqual({
      subject: "tenant-service-role",
      tenantSlug: "example-tenant",
      roles: ["operator"],
      source: "authorizer"
    });
  });
});
