import { ValidationError } from "../../../shared/src/errors";

export interface VerifiedIdentityContext {
  tenantId: string;
  userId: string;
  role: string;
  sessionId: string;
  requestId: string;
  source: "jwt" | "authorizer" | "lambda-authorizer" | "cognito";
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

export interface ClientDeclaredIdentityOptions {
  recursive?: boolean;
}

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

function declaredIdentityKeys(value: unknown, recursive: boolean, path = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const declared = entries
    .filter(([key]) => clientIdentityKeys.has(key))
    .map(([key]) => (path ? `${path}.${key}` : key));
  if (!recursive) {
    return declared;
  }
  return [
    ...declared,
    ...entries.flatMap(([key, entryValue]) => {
      const entryPath = path ? `${path}.${key}` : key;
      if (Array.isArray(entryValue)) {
        return entryValue.flatMap((item, index) => declaredIdentityKeys(item, true, `${entryPath}.${index}`));
      }
      return declaredIdentityKeys(entryValue, true, entryPath);
    })
  ];
}

export function assertNoClientDeclaredIdentity(value: unknown, options: ClientDeclaredIdentityOptions = {}): void {
  const declaredKeys = declaredIdentityKeys(value, options.recursive === true);
  if (declaredKeys.length > 0) {
    throw new ValidationError("Client-declared tenant, user, or session identity is not accepted", {
      declaredKeys: declaredKeys.sort()
    });
  }
}
