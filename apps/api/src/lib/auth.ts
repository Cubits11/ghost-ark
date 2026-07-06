import { APIGatewayProxyEventV2 } from "aws-lambda";
import { tenantSlugSchema } from "../../../../packages/receipt-schema/src/receipt";
import { AuthorizationError, ValidationError } from "../../../../packages/shared/src/errors";

export interface AuthenticatedPrincipal {
  subject: string;
  tenantSlug: string;
  roles: string[];
  source: "jwt" | "iam" | "developer-header";
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === lower)?.[1];
}

export function authenticate(event: APIGatewayProxyEventV2): AuthenticatedPrincipal {
  const requestContext = event.requestContext as APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = requestContext.authorizer?.jwt?.claims;
  const jwtTenant = typeof claims?.tenant_slug === "string" ? claims.tenant_slug : undefined;
  const jwtSubject = typeof claims?.sub === "string" ? claims.sub : undefined;
  const jwtRoles = typeof claims?.roles === "string" ? claims.roles.split(/\s+/u).filter(Boolean) : [];

  const devTenant = process.env.ALLOW_DEVELOPER_HEADERS === "true" ? header(event, "x-tenant-slug") : undefined;
  const tenantSlug = jwtTenant ?? devTenant;
  if (!tenantSlug) {
    throw new AuthorizationError("Missing tenant identity");
  }

  const parsedTenant = tenantSlugSchema.safeParse(tenantSlug);
  if (!parsedTenant.success) {
    throw new ValidationError("Invalid tenant identity", { issues: parsedTenant.error.issues });
  }

  return {
    subject: jwtSubject ?? header(event, "x-principal-subject") ?? "unknown-principal",
    tenantSlug: parsedTenant.data,
    roles: jwtRoles,
    source: jwtTenant ? "jwt" : "developer-header"
  };
}
