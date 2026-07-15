import { decisionReceiptDigest, decisionReceiptRequestDigest, signedDecisionReceiptHash } from "./canonical";
import {
  ChainHeadConflictError,
  DecisionReceiptChainHead,
  DecisionReceiptPersistenceResult,
  DecisionReceiptRepository,
  IntegrityCollisionError
} from "./repository";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export class InMemoryDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly receipts = new Map<string, SignedDecisionReceipt>();
  private readonly requestMarkers = new Map<
    string,
    { receiptId: string; requestDigest: string; persistedAt: string }
  >();
  private readonly chainHeads = new Map<string, { receiptId: string; headHash: string; updatedAt: string }>();

  async put(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult> {
    const validated = validateSignedDecisionReceipt(receipt);
    const key = this.key(validated.tenant_id_hash, validated.receipt_id);
    const requestMarkerKey = this.key(validated.tenant_id_hash, requestMarkerReceiptId(validated.request_id));
    const requestDigest = decisionReceiptRequestDigest(validated);
    const requestMarker = this.requestMarkers.get(requestMarkerKey);
    if (requestMarker) {
      if (requestMarker.requestDigest !== requestDigest) {
        throw new IntegrityCollisionError("Receipt request id replay detected with mismatched canonical request digest", {
          tenantId: validated.tenant_id_hash,
          requestId: validated.request_id,
          incomingRequestDigest: requestDigest,
          storedRequestDigest: requestMarker.requestDigest
        });
      }
      const existing = this.receipts.get(this.key(validated.tenant_id_hash, requestMarker.receiptId));
      if (!existing) {
        throw new IntegrityCollisionError("Receipt request marker exists but the target receipt was not found", {
          tenantId: validated.tenant_id_hash,
          requestId: validated.request_id,
          targetReceiptId: requestMarker.receiptId
        });
      }
      return { status: "IDEMPOTENT_EXISTING", receipt: existing, persistedAt: requestMarker.persistedAt };
    }

    const existing = this.receipts.get(key);
    if (existing) {
      const incomingDigest = decisionReceiptDigest(validated);
      const storedDigest = decisionReceiptDigest(existing);
      if (incomingDigest !== storedDigest) {
        throw new IntegrityCollisionError("Receipt primary key collision detected with mismatched canonical digests", {
          tenantId: validated.tenant_id_hash,
          receiptId: validated.receipt_id,
          incomingDigest,
          storedDigest
        });
      }
      return { status: "IDEMPOTENT_EXISTING", receipt: existing, persistedAt: existing.timestamp };
    }

    const currentHead = this.chainHeads.get(validated.tenant_id_hash)?.headHash ?? null;
    if (validated.prev_receipt_hash !== currentHead) {
      throw new ChainHeadConflictError("Receipt chain head advanced before receipt could be persisted", {
        tenantId: validated.tenant_id_hash,
        receiptId: validated.receipt_id,
        expectedPreviousHash: validated.prev_receipt_hash,
        observedHead: currentHead
      });
    }

    this.receipts.set(key, validated);
    this.requestMarkers.set(requestMarkerKey, {
      receiptId: validated.receipt_id,
      requestDigest,
      persistedAt: validated.timestamp
    });
    this.chainHeads.set(validated.tenant_id_hash, {
      receiptId: validated.receipt_id,
      headHash: signedDecisionReceiptHash(validated),
      updatedAt: validated.timestamp
    });
    return { status: "CREATED", receipt: validated, persistedAt: validated.timestamp };
  }

  async get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null> {
    return this.receipts.get(this.key(input.tenantId, input.receiptId)) ?? null;
  }

  async latestHashForTenant(input: { tenantId: string }): Promise<string | null> {
    return this.chainHeads.get(input.tenantId)?.headHash ?? null;
  }

  async listChainHeads(): Promise<DecisionReceiptChainHead[]> {
    return [...this.chainHeads.entries()]
      .map(([tenantId, head]) => ({ tenantId, ...head }))
      .sort((left, right) => left.tenantId.localeCompare(right.tenantId));
  }

  all(): SignedDecisionReceipt[] {
    return [...this.receipts.values()].sort((left, right) => {
      const timestampOrder = left.timestamp.localeCompare(right.timestamp);
      return timestampOrder === 0 ? left.receipt_id.localeCompare(right.receipt_id) : timestampOrder;
    });
  }

  private key(tenantIdHash: string, receiptId: string): string {
    return `${tenantIdHash}:${receiptId}`;
  }
}

function requestMarkerReceiptId(requestId: string): string {
  return `__request__#${encodeURIComponent(requestId)}`;
}
