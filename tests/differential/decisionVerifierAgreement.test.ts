/**
 * "No unproven pixels" proof for the decision-receipt (grct_) + chain engine.
 *
 * Runs the browser verifier (on globalThis.crypto.subtle, which exists in Node)
 * against the REAL reproducibility fixtures, asserting the three honest verdicts:
 *   - HMAC dev-only receipts + their chain PASS;
 *   - KMS RSA-PSS digest-as-message PASSES;
 *   - KMS digest-as-mhash returns UNVERIFIABLE (not FAIL) — the receipt is
 *     genuine (the Node verifier confirms it), Web Crypto just cannot check it;
 *   - tampers and chain breaks fail closed at the right step.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  verifyDecisionReceiptWeb,
  verifyDecisionChainWeb,
  signedDecisionReceiptHashWeb,
} from "../../apps/glasshouse/lib/decisionVerifier";

const R = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf-8"));
const F = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const base64ToBytesLocal = (b: string): Uint8Array => new Uint8Array(Buffer.from(b, "base64"));
const flipB64 = (s: string): string => { const i = s.length >> 1; return s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1); };

const HMAC_SECRET = "ghost-ark-repro-signing-dev-only-test-vector-v1";
const baseline = R("examples/reproducibility/receipts/hmac-baseline.receipt.json");
const chained = R("examples/reproducibility/receipts/hmac-chained.receipt.json");
const kmsMsg = R("examples/reproducibility/receipts/kms-style-rsa.receipt.json");
const kmsMsgKey = F("examples/reproducibility/keys/kms-style-public-key.pem");
const kmsMhash = R("examples/reproducibility/pss-digest-mode/kms-digest-mode.receipt.json");
const kmsMhashKey = F("examples/reproducibility/pss-digest-mode/public-key.pem");

describe("decision receipts — the three honest verdicts", () => {
  it("HMAC dev-only baseline → PASS, and the signature detail flags it symmetric/dev-only", async () => {
    const rep = await verifyDecisionReceiptWeb(baseline, { hmacSecret: HMAC_SECRET });
    expect(rep.checks.filter((c) => !c.passed), JSON.stringify(rep.checks.filter((c) => !c.passed))).toHaveLength(0);
    expect(rep.verdict).toBe("PASS");
    expect(rep.checks.find((c) => c.name === "signature")?.detail).toMatch(/DEV-ONLY|symmetric/i);
  });

  it("HMAC without the secret fails closed at the signature step", async () => {
    const rep = await verifyDecisionReceiptWeb(baseline, {});
    expect(rep.verdict).toBe("FAIL");
    expect(rep.checks.find((c) => c.name === "signature")?.passed).toBe(false);
  });

  it("KMS RSA-PSS digest-as-message → PASS (subtle can verify it)", async () => {
    const rep = await verifyDecisionReceiptWeb(kmsMsg, { publicKeyPem: kmsMsgKey, pssMode: "digest-as-message" });
    expect(rep.verdict, JSON.stringify(rep.checks.filter((c) => !c.passed))).toBe("PASS");
  });

  it("KMS digest-as-mhash → PASS via the BigInt EMSA-PSS engine (what subtle cannot do)", async () => {
    const rep = await verifyDecisionReceiptWeb(kmsMhash, { publicKeyPem: kmsMhashKey, pssMode: "digest-as-mhash" });
    expect(rep.verdict, JSON.stringify(rep.checks.filter((c) => !c.passed))).toBe("PASS");
    const sig = rep.checks.find((c) => c.name === "signature");
    expect(sig?.passed).toBe(true);
    expect(sig?.detail).toMatch(/BigInt EMSA-PSS|Web Crypto cannot/i);
  });

  it("digest-as-mhash with a flipped signature → FAIL (the BigInt engine rejects tampering)", async () => {
    const env = JSON.parse(new TextDecoder().decode(base64ToBytesLocal(kmsMhash.receipt_signature)));
    env.signature = flipB64(env.signature);
    const forged = { ...kmsMhash, receipt_signature: btoa(JSON.stringify(env)) };
    const rep = await verifyDecisionReceiptWeb(forged, { publicKeyPem: kmsMhashKey, pssMode: "digest-as-mhash" });
    expect(rep.verdict).toBe("FAIL");
    expect(rep.checks.find((c) => c.name === "signature")?.passed).toBe(false);
  });
});

describe("decision receipts — tampers fail closed", () => {
  it("flipped receipt_id → FAIL at receipt_id", async () => {
    const m = JSON.parse(JSON.stringify(baseline));
    m.receipt_id = m.receipt_id.slice(0, -1) + (m.receipt_id.slice(-1) === "a" ? "b" : "a");
    const rep = await verifyDecisionReceiptWeb(m, { hmacSecret: HMAC_SECRET });
    expect(rep.verdict).toBe("FAIL");
    expect(rep.checks.find((c) => c.name === "receipt_id")?.passed).toBe(false);
  });

  it("mutated policy_hash (in the signed payload) → FAIL (identity + digest break)", async () => {
    const m = JSON.parse(JSON.stringify(baseline));
    m.policy_hash = "cafebabe".repeat(8);
    const rep = await verifyDecisionReceiptWeb(m, { hmacSecret: HMAC_SECRET });
    expect(rep.verdict).toBe("FAIL");
    expect(rep.checks.find((c) => c.name === "digest")?.passed).toBe(false);
  });

  it("expected-tenant mismatch → FAIL at tenant (consumer boundary)", async () => {
    const rep = await verifyDecisionReceiptWeb(baseline, { hmacSecret: HMAC_SECRET, expectedTenantIdHash: "hmac-sha256:" + "0".repeat(64) });
    expect(rep.verdict).toBe("FAIL");
    expect(rep.checks.find((c) => c.name === "tenant")?.passed).toBe(false);
  });
});

describe("decision-receipt chain", () => {
  it("verifies the real baseline→chained link (prev_receipt_hash === signed hash of the head)", async () => {
    const links = await verifyDecisionChainWeb([baseline, chained]);
    expect(links.every((l) => l.passed), JSON.stringify(links)).toBe(true);
    // The link value the fixture records must equal our recomputed signed hash of the head.
    expect(chained.prev_receipt_hash).toBe(await signedDecisionReceiptHashWeb(baseline));
  });

  it("reversed order breaks the chain (head must have no prev hash)", async () => {
    const links = await verifyDecisionChainWeb([chained, baseline]);
    expect(links[0].passed).toBe(false);
    expect(links[0].detail).toMatch(/head|previous hash/i);
  });

  it("a re-pointed prev_receipt_hash breaks the hash link", async () => {
    const forged = JSON.parse(JSON.stringify(chained));
    forged.prev_receipt_hash = "sha256:" + "0".repeat(64);
    const links = await verifyDecisionChainWeb([baseline, forged]);
    expect(links[1].passed).toBe(false);
    expect(links[1].detail).toMatch(/hash-chain break/i);
  });

  it("a cross-tenant receipt breaks tenant continuity", async () => {
    const other = JSON.parse(JSON.stringify(chained));
    other.tenant_id_hash = "hmac-sha256:" + "9".repeat(64);
    const links = await verifyDecisionChainWeb([baseline, other]);
    expect(links[1].passed).toBe(false);
    expect(links[1].detail).toMatch(/tenant-chain break/i);
  });
});
