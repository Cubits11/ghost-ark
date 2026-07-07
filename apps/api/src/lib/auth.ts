import { APIGatewayProxyEventV2 } from "aws-lambda";
import { tenantSlugSchema } from "../../../../packages/receipt-schema/src/receipt";
import { AuthorizationError, ValidationError } from "../../../../packages/shared/src/errors";

export interface AuthenticatedPrincipal {
  subject: string;
  tenantSlug: string;
  roles: string[];
  source: "jwt" | "authorizer";
}

type Claims = Record<string, unknown>;

interface AuthorizerContext {
  jwt?: { claims?: Claims };
  claims?: Claims;
  tenant_slug?: unknown;
  tenantSlug?: unknown;
  "custom:tenant_slug"?: unknown;
  principalId?: unknown;
  roles?: unknown;
  [key: string]: unknown;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function claim(claims: Claims | undefined, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = stringValue(claims?.[name]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((role): role is string => typeof role === "string" && role.length > 0);
  }
  return typeof value === "string" ? value.split(/[\s,]+/u).filter(Boolean) : [];
}

export function authenticate(event: APIGatewayProxyEventV2): AuthenticatedPrincipal {
  const requestContext = event.requestContext as APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: AuthorizerContext;
  };
  const authorizer = requestContext.authorizer;
  const claims = authorizer?.jwt?.claims ?? authorizer?.claims;
  const jwtTenant = claim(claims, "tenant_slug", "custom:tenant_slug", "tenantSlug");
  const authorizerTenant = stringValue(authorizer?.tenant_slug) ?? stringValue(authorizer?.["custom:tenant_slug"]) ?? stringValue(authorizer?.tenantSlug);
  const jwtSubject = claim(claims, "sub", "username", "cognito:username") ?? stringValue(authorizer?.principalId);
  const jwtRoles = parseRoles(claims?.roles ?? claims?.["cognito:groups"] ?? authorizer?.roles);

  const tenantSlug = jwtTenant ?? authorizerTenant;
  if (!tenantSlug) {
    throw new AuthorizationError("Missing tenant identity");
  }

  const parsedTenant = tenantSlugSchema.safeParse(tenantSlug);
  if (!parsedTenant.success) {
    throw new ValidationError("Invalid tenant identity", { issues: parsedTenant.error.issues });
  }

  return {
    subject: jwtSubject ?? "unknown-principal",
    tenantSlug: parsedTenant.data,
    roles: jwtRoles,
    source: jwtTenant ? "jwt" : "authorizer"
  };
}
