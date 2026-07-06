#!/usr/bin/env node
import fs from "fs";
import { ReceiptRepository } from "../../services/ledger/dynamodb/data/receiptRepository";
import { ClaimRepository } from "../../services/ledger/dynamodb/data/claimRepository";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const tenantSlug = arg("tenant");
  const claimId = arg("claim");
  const output = arg("output", `evidence-pack-${tenantSlug}-${claimId}.json`);
  const claims = new ClaimRepository({ tableName: arg("claims-table", process.env.CLAIM_LEDGER_TABLE) });
  const receipts = new ReceiptRepository({ tableName: arg("receipts-table", process.env.RECEIPT_LEDGER_TABLE) });
  const claim = await claims.get(tenantSlug, claimId);
  const receiptRecords = await Promise.all(claim.receiptIds.map((receiptId) => receipts.get(tenantSlug, receiptId)));
  const pack = {
    exportedAt: new Date().toISOString(),
    tenantSlug,
    claim,
    receipts: receiptRecords,
    nonClaims: [
      "Receipt signatures attest canonical payload handling, not empirical truth.",
      "This export is not a certification by itself."
    ]
  };
  fs.writeFileSync(output, JSON.stringify(pack, null, 2));
  console.log(JSON.stringify({ output, receiptCount: receiptRecords.length }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
