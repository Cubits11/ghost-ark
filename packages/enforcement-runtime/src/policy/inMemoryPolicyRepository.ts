import { AuthorizationError } from "../../../shared/src/errors";
import { PolicyRepository, PolicyRepositoryLoadInput, DEFAULT_GOVERNED_INVOKE_POLICY } from "./repository";
import { PolicySource } from "./schema";

function tenantKey(tenantId: string): string {
  return `tenant:${tenantId}`;
}

function userKey(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly tenantPolicies = new Map<string, PolicySource[]>();
  private readonly userPolicies = new Map<string, PolicySource[]>();
  private readonly defaultPolicy: PolicySource;

  constructor(options: { defaultPolicy?: PolicySource; policiesByTenant?: Record<string, PolicySource[]> } = {}) {
    this.defaultPolicy = options.defaultPolicy ?? DEFAULT_GOVERNED_INVOKE_POLICY;
    for (const [tenantId, policies] of Object.entries(options.policiesByTenant ?? {})) {
      this.putTenantPolicies(tenantId, policies);
    }
  }

  putTenantPolicies(tenantId: string, policies: PolicySource[]): void {
    this.tenantPolicies.set(tenantKey(tenantId), [...policies]);
  }

  putUserPolicies(tenantId: string, userId: string, policies: PolicySource[]): void {
    this.userPolicies.set(userKey(tenantId, userId), [...policies]);
  }

  async loadPolicies(input: PolicyRepositoryLoadInput): Promise<PolicySource[]> {
    if (!input.tenantId || !input.userId) {
      throw new AuthorizationError("Tenant and user identity are required to load policies");
    }
    const policies = [
      ...(this.tenantPolicies.get(tenantKey(input.tenantId)) ?? []),
      ...(this.userPolicies.get(userKey(input.tenantId, input.userId)) ?? [])
    ];
    return policies.length > 0 ? policies : [this.defaultPolicy];
  }
}
