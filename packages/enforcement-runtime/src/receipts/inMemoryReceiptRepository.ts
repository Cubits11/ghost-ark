import { DecisionReceiptRepository } from "./repository";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export class InMemoryDecisionReceiptRepository implements DecisionReceiptRepository {
  private readonly receipts = new Map<string, SignedDecisionReceipt>();

  async put(receipt: SignedDecisionReceipt): Promise<void> {
    const validated = validateSignedDecisionReceipt(receipt);
    this.receipts.set(this.key(validated.tenant_id_hash, validated.receipt_id), validated);
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
