import { signedDecisionReceiptHash } from "./canonical";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "./schema";

export interface ReceiptChainCheck {
  index: number;
  passed: boolean;
  detail: string;
}

export function verifyDecisionReceiptChain(receipts: SignedDecisionReceipt[]): ReceiptChainCheck[] {
  return receipts.map((receipt, index) => {
    validateSignedDecisionReceipt(receipt);
    if (index === 0) {
      return receipt.prev_receipt_hash === null
        ? { index, passed: true, detail: "First receipt has no previous receipt hash." }
        : { index, passed: false, detail: "First receipt unexpectedly declares a previous receipt hash." };
    }

    const expected = signedDecisionReceiptHash(receipts[index - 1]);
    return receipt.prev_receipt_hash === expected
      ? { index, passed: true, detail: "Previous receipt hash matches prior signed receipt." }
      : {
          index,
          passed: false,
          detail: `Hash-chain break. Expected ${expected}; observed ${receipt.prev_receipt_hash ?? "null"}.`
        };
  });
}
