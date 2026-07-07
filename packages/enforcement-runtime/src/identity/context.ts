import { ValidationError } from "../../../shared/src/errors";

export interface VerifiedIdentityContext {
  tenantId: string;
  userId: string;
  role: string;
  sessionId: string;
  requestId: string;
  source: "jwt" | "lambda-authorizer" | "cognito";
}

export interface ResolveIdentityInput {
  authorizer: {
    tenantId?: string;
    userId?: string;
    role?: string;
    sessionId?: string;
    requestId?: string;
    source?: VerifiedIdentityContext["source"];
  };
  requestId?: string;
}

const clientIdentityKeys = new Set([
  "tenant_id",
  "tenantId",
  "tenantSlug",
  "tenant_slug",
  "user_id",
  "userId",
  "session_id",
  "sessionId"
]);

export function resolveVerifiedIdentity(input: ResolveIdentityInput): VerifiedIdentityContext {
  const identity = input.authorizer;
  if (!identity.tenantId || !identity.userId) {
    throw new ValidationError("Verified tenant and user identity are required");
  }
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    role: identity.role ?? "user",
    sessionId: identity.sessionId ?? "session-unknown",
    requestId: identity.requestId ?? input.requestId ?? "request-unknown",
    source: identity.source ?? "lambda-authorizer"
  };
}

export function assertNoClientDeclaredIdentity(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const declaredKeys = Object.keys(value).filter((key) => clientIdentityKeys.has(key));
  if (declaredKeys.length > 0) {
    throw new ValidationError("Client-declared tenant, user, or session identity is not accepted", {
      declaredKeys: declaredKeys.sort()
    });
  }
}
