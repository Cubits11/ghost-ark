import { signedDecisionReceiptHash } from "./canonical";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export interface ReceiptChainCheck {
  index: number;
  passed: boolean;
  detail: string;
}

export function verifyDecisionReceiptChain(receipts: unknown[]): ReceiptChainCheck[] {
  if (!Array.isArray(receipts)) {
    return [{ index: -1, passed: false, detail: "Receipt chain must be an array." }];
  }
  if (receipts.length === 0) {
    return [{ index: -1, passed: false, detail: "Receipt chain must contain at least one receipt." }];
  }

  const validated = receipts.map((receipt) => {
    try {
      return { receipt: validateSignedDecisionReceipt(receipt), error: null };
    } catch (error) {
      return { receipt: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const firstTenant = validated[0].receipt?.tenant_id_hash;
  const seenHashes = new Set<string>();

  return validated.map((entry, index) => {
    const receipt = entry.receipt;
    if (!receipt) {
      return { index, passed: false, detail: `Receipt schema validation failed: ${entry.error}` };
    }

    if (firstTenant && receipt.tenant_id_hash !== firstTenant) {
      return {
        index,
        passed: false,
        detail: `Tenant-chain break. Expected tenant ${firstTenant}; observed ${receipt.tenant_id_hash}.`
      };
    }

    const currentHash = signedDecisionReceiptHash(receipt);
    if (seenHashes.has(currentHash)) {
      return { index, passed: false, detail: `Duplicate signed receipt hash observed: ${currentHash}.` };
    }
    seenHashes.add(currentHash);

    if (index === 0) {
      return receipt.prev_receipt_hash === null
        ? { index, passed: true, detail: "First receipt has no previous receipt hash." }
        : { index, passed: false, detail: "First receipt unexpectedly declares a previous receipt hash." };
    }

    const previous = validated[index - 1].receipt;
    if (!previous) {
      return {
        index,
        passed: false,
        detail: "Cannot verify receipt chain continuity because the prior receipt is invalid."
      };
    }
    if (Date.parse(receipt.timestamp) < Date.parse(previous.timestamp)) {
      return {
        index,
        passed: false,
        detail: `Receipt timestamp ${receipt.timestamp} is earlier than prior receipt timestamp ${previous.timestamp}.`
      };
    }

    const expected = signedDecisionReceiptHash(previous);
    return receipt.prev_receipt_hash === expected
      ? { index, passed: true, detail: "Previous receipt hash matches prior signed receipt." }
      : {
          index,
          passed: false,
          detail: `Hash-chain break. Expected ${expected}; observed ${receipt.prev_receipt_hash ?? "null"}.`
        };
  });
}
