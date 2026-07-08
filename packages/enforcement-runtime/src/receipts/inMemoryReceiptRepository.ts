import { decisionReceiptDigest } from "./canonical";
import { DecisionReceiptPersistenceResult, DecisionReceiptRepository, IntegrityCollisionError } from "./repository";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export class InMemoryDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly receipts = new Map<string, SignedDecisionReceipt>();

  async put(receipt: SignedDecisionReceipt): Promise<DecisionReceiptPersistenceResult> {
    const validated = validateSignedDecisionReceipt(receipt);
    const key = this.key(validated.tenant_id_hash, validated.receipt_id);
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

    this.receipts.set(key, validated);
    return { status: "CREATED", receipt: validated, persistedAt: validated.timestamp };
  }

  async get(input: { tenantId: string; receiptId: string }): Promise<SignedDecisionReceipt | null> {
    return this.receipts.get(this.key(input.tenantId, input.receiptId)) ?? null;
  }

  all(): SignedDecisionReceipt[] {
    return [...this.receipts.values()].sort((left, right) => left.receipt_id.localeCompare(right.receipt_id));
  }

  private key(tenantIdHash: string, receiptId: string): string {
    return `${tenantIdHash}:${receiptId}`;
  }
}
