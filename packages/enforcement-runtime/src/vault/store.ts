import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { AuthorizationError, ValidationError } from "../../../shared/src/errors";
import { ConsentState, PolicyDecision } from "../policy/decisions";
import { hasRestrictedMemoryConsent, restrictedConsentReason } from "./consent";
import { MemoryRecord, MemoryTier } from "./tiers";

export interface VaultIdentity {
  tenantId: string;
  userId: string;
  sessionId?: string;
}

export interface MemoryWriteRequest extends VaultIdentity {
  tier: MemoryTier;
  contentDigest: string;
  classificationTags?: string[];
  expiresAt?: string;
  now?: string;
}

export interface MemoryWriteResult {
  written: boolean;
  reason: string;
  record?: MemoryRecord;
}

export interface MemoryReadRequest extends VaultIdentity {
  includeTiers?: MemoryTier[];
  now?: string;
}

export interface VaultStore {
  write(
    request: MemoryWriteRequest,
    decision: PolicyDecision,
    consentState?: ConsentState
  ): Promise<MemoryWriteResult> | MemoryWriteResult;
  list(request: MemoryReadRequest): Promise<MemoryRecord[]> | MemoryRecord[];
  get(request: VaultIdentity & { id: string; now?: string }): Promise<MemoryRecord> | MemoryRecord;
  tombstone(request: VaultIdentity & { id: string; now?: string }): Promise<MemoryRecord> | MemoryRecord;
  deleteErasable(request: VaultIdentity & { id: string; now?: string }): Promise<void> | void;
  exportUserMemory(request: VaultIdentity & { now?: string }): Promise<MemoryRecord[]> | MemoryRecord[];
}

function isExpired(record: MemoryRecord, now: string): boolean {
  return Boolean(record.expiresAt && record.expiresAt <= now);
}

function recordId(input: MemoryWriteRequest): string {
  return `mem_${canonicalSha256Hex({
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    tier: input.tier,
    contentDigest: input.contentDigest
  })}`;
}

export class InMemoryVaultStore implements VaultStore {
  private readonly records = new Map<string, MemoryRecord>();

  write(request: MemoryWriteRequest, decision: PolicyDecision, consentState: ConsentState = "missing"): MemoryWriteResult {
    if (decision.decision === "MEMORY_SUPPRESS") {
      return { written: false, reason: "policy decision MEMORY_SUPPRESS prevented persistence" };
    }
    if (request.tier === "KAPPA") {
      return { written: false, reason: "KAPPA memory is invocation-only and is never persisted" };
    }
    if (request.tier === "SESSION" && !request.expiresAt) {
      throw new ValidationError("SESSION memory requires an explicit expiresAt timestamp");
    }
    if (!hasRestrictedMemoryConsent(request.tier, consentState)) {
      return {
        written: false,
        reason: restrictedConsentReason(request.tier, consentState) ?? "restricted memory consent missing"
      };
    }

    const now = request.now ?? new Date().toISOString();
    const record: MemoryRecord = {
      id: recordId(request),
      tenantId: request.tenantId,
      userId: request.userId,
      sessionId: request.sessionId,
      tier: request.tier,
      contentDigest: request.contentDigest,
      classificationTags: [...(request.classificationTags ?? [])].sort(),
      createdAt: now,
      expiresAt: request.expiresAt
    };
    this.records.set(record.id, record);
    return { written: true, reason: "memory persisted", record };
  }

  list(request: MemoryReadRequest): MemoryRecord[] {
    const now = request.now ?? new Date().toISOString();
    const includeTiers = new Set(request.includeTiers ?? ["SESSION", "CONSTITUTION", "AUDIT", "RESTRICTED"]);
    return [...this.records.values()]
      .filter((record) => record.tenantId === request.tenantId)
      .filter((record) => record.userId === request.userId)
      .filter((record) => !request.sessionId || record.sessionId === request.sessionId)
      .filter((record) => includeTiers.has(record.tier))
      .filter((record) => !record.tombstonedAt)
      .filter((record) => !isExpired(record, now))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  get(request: VaultIdentity & { id: string; now?: string }): MemoryRecord {
    const now = request.now ?? new Date().toISOString();
    const record = this.records.get(request.id);
    if (!record || record.tombstonedAt || isExpired(record, now)) {
      throw new ValidationError("Memory record is unavailable");
    }
    if (record.tenantId !== request.tenantId || record.userId !== request.userId) {
      throw new AuthorizationError("Cross-tenant or cross-user memory access denied", {
        requestedId: request.id
      });
    }
    return record;
  }

  tombstone(request: VaultIdentity & { id: string; now?: string }): MemoryRecord {
    const record = this.get(request);
    const tombstoned = { ...record, tombstonedAt: request.now ?? new Date().toISOString() };
    this.records.set(record.id, tombstoned);
    return tombstoned;
  }

  deleteErasable(request: VaultIdentity & { id: string; now?: string }): void {
    const record = this.get(request);
    if (record.tier === "AUDIT") {
      this.tombstone(request);
      return;
    }
    this.records.delete(record.id);
  }

  exportUserMemory(request: VaultIdentity & { now?: string }): MemoryRecord[] {
    return this.list({ ...request, includeTiers: ["SESSION", "CONSTITUTION", "RESTRICTED"], now: request.now });
  }
}
