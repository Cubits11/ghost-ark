import { describe, it, expect } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { upperBound } from "../../../../packages/research-frontier/src/chaitin/complexityBudget";
import { evaluateComprehension } from "../../../../packages/research-frontier/src/chaitin/comprehensionGate";
import {
  buildChaitinReceipt,
  verifyChaitinReceipt,
} from "../../../../packages/research-frontier/src/chaitin/receipt";
import { danf } from "../../../../packages/research-frontier/src/lobian/receipt";
import { xorshift32Stream } from "./complexityBudget.test";

const TS = "2026-07-17T00:00:00Z";
const TKEY = "test-chaitin-key";
const structured = JSON.stringify(
  Array.from({ length: 100 }, (_, i) => ({ gate: "ledger", nonce: `n${i}`, verdict: "fresh" })),
);

describe("comprehension gate — one-sided boundary", () => {
  it("admits structured payloads within budget (WITHIN_BUDGET)", () => {
    const v = evaluateComprehension(structured, 2048);
    expect(v.status).toBe("WITHIN_BUDGET");
    expect(v.witness.upper_bound_bytes).toBeLessThanOrEqual(2048);
  });

  it("refuses random bytes (EVALUATION_UNDECIDABLE), fail-closed", () => {
    const v = evaluateComprehension(randomBytes(4096), 2048);
    expect(v.status).toBe("EVALUATION_UNDECIDABLE");
    expect(v.note).toMatch(/NOT a finding/);
  });

  it("KEYSTONE: refuses the structurally-simple PRNG stream — the one-sided error is real and stated", () => {
    const v = evaluateComprehension(xorshift32Stream(0xdeadbeef, 4096), 2048);
    expect(v.status).toBe("EVALUATION_UNDECIDABLE"); // simple in truth, refused in practice
  });

  it("verdict flips exactly at U(x): budget monotonicity", () => {
    const u = upperBound(structured).upper_bound_bytes;
    expect(evaluateComprehension(structured, u).status).toBe("WITHIN_BUDGET");
    expect(evaluateComprehension(structured, u - 1).status).toBe("EVALUATION_UNDECIDABLE");
  });

  it("rejects malformed budgets", () => {
    expect(() => evaluateComprehension("x", -1)).toThrow();
    expect(() => evaluateComprehension("x", 1.5)).toThrow();
  });
});

describe("GHOST-CHAITIN-V1 receipts — replayable witnesses", () => {
  it("clean receipts verify structurally and replay against the payload", () => {
    for (const [payload, budget] of [
      [structured, 2048],
      [randomBytes(1024), 512],
    ] as const) {
      const r = buildChaitinReceipt(evaluateComprehension(payload, budget), payload, TS, TKEY);
      const structural = verifyChaitinReceipt(r, { hmacKey: TKEY });
      expect(structural.valid).toBe(true);
      expect(structural.checks.witness_replays).toBeNull(); // no payload supplied
      const replayed = verifyChaitinReceipt(r, { payload, hmacKey: TKEY });
      expect(replayed.valid).toBe(true);
      expect(replayed.checks.witness_replays).toBe(true);
    }
  });

  it("deterministic: same payload+budget+timestamp ⇒ identical digest and signature", () => {
    const a = buildChaitinReceipt(evaluateComprehension(structured, 2048), structured, TS, TKEY);
    const b = buildChaitinReceipt(evaluateComprehension(structured, 2048), structured, TS, TKEY);
    expect(a.content_digest).toBe(b.content_digest);
    expect(a.signature).toBe(b.signature);
  });

  it("tampered byte counts without re-signing fail the digest", () => {
    const r = structuredClone(
      buildChaitinReceipt(evaluateComprehension(structured, 2048), structured, TS, TKEY),
    );
    (r.witness.measurements as { compressed_bytes: number }[])[0].compressed_bytes = 3;
    const v = verifyChaitinReceipt(r, { hmacKey: TKEY });
    expect(v.checks.digest_matches).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("an inconsistent upper bound (≠ min of measurements) fails structurally, even unsigned-consistent", () => {
    const r = structuredClone(
      buildChaitinReceipt(evaluateComprehension(structured, 2048), structured, TS, TKEY),
    );
    (r.witness as { upper_bound_bytes: number }).upper_bound_bytes = 1;
    // attacker re-digests and re-signs honestly:
    const unsigned = {
      protocol: r.protocol,
      status: r.status,
      payload_digest: r.payload_digest,
      budget_bytes: r.budget_bytes,
      witness: r.witness,
      timestamp: r.timestamp,
    };
    r.content_digest = `sha256:${createHash("sha256").update(danf(unsigned)).digest("hex")}`;
    r.signature = createHmac("sha256", TKEY).update(r.content_digest).digest("hex");
    const v = verifyChaitinReceipt(r, { hmacKey: TKEY });
    expect(v.checks.digest_matches).toBe(true);
    expect(v.checks.signature_matches).toBe(true);
    expect(v.checks.min_correct).toBe(false); // caught without needing the payload
    expect(v.valid).toBe(false);
  });

  it("MUTATION KEYSTONE: forged simplicity — doctored measurements, re-signed — dies on replay, not signature", () => {
    // Attacker takes a refused random payload and forges a WITHIN_BUDGET receipt
    // by writing small byte counts, keeping min-consistency, and re-signing.
    const payload = randomBytes(4096);
    const honest = buildChaitinReceipt(evaluateComprehension(payload, 2048), payload, TS, TKEY);
    expect(honest.status).toBe("EVALUATION_UNDECIDABLE");

    const forged = structuredClone(honest);
    (forged as { status: string }).status = "WITHIN_BUDGET";
    (forged.witness.measurements as { compressed_bytes: number }[]).forEach(
      (m) => (m.compressed_bytes = 100),
    );
    (forged.witness as { upper_bound_bytes: number }).upper_bound_bytes = 100;
    const unsigned = {
      protocol: forged.protocol,
      status: forged.status,
      payload_digest: forged.payload_digest,
      budget_bytes: forged.budget_bytes,
      witness: forged.witness,
      timestamp: forged.timestamp,
    };
    forged.content_digest = `sha256:${createHash("sha256").update(danf(unsigned)).digest("hex")}`;
    forged.signature = createHmac("sha256", TKEY).update(forged.content_digest).digest("hex");

    const structural = verifyChaitinReceipt(forged, { hmacKey: TKEY });
    expect(structural.checks.digest_matches).toBe(true);
    expect(structural.checks.signature_matches).toBe(true);
    expect(structural.checks.min_correct).toBe(true);
    expect(structural.checks.verdict_consistent).toBe(true); // internally coherent lie

    const replayed = verifyChaitinReceipt(forged, { payload, hmacKey: TKEY });
    expect(replayed.checks.witness_replays).toBe(false); // recompute disagrees
    expect(replayed.valid).toBe(false); // rejected on evidence, not signature
  });
});
