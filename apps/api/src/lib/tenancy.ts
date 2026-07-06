import { AuthorizationError } from "../../../../packages/shared/src/errors";
import { AuthenticatedPrincipal } from "./auth";

export function assertTenantAccess(principal: AuthenticatedPrincipal, tenantSlug: string): void {
  if (principal.tenantSlug !== tenantSlug) {
    throw new AuthorizationError("Cross-tenant access denied", {
      principalTenant: principal.tenantSlug,
      requestedTenant: tenantSlug
    });
  }
}

export function tenantFilter(principal: AuthenticatedPrincipal): { term: { tenantSlug: string } } {
  return { term: { tenantSlug: principal.tenantSlug } };
}
