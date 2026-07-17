import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  upperBound,
  evaluatorAnchoredBudget,
} from "../../../../packages/research-frontier/src/chaitin/complexityBudget";

/** xorshift32 — a tiny PRNG whose whole generating program is a few hundred
 *  bytes. Its output stream has TINY true description length but is opaque to
 *  general-purpose compressors: the keystone of the one-sidedness argument. */
export function xorshift32Stream(seed: number, n: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  return out;
}

describe("upperBound — computable one-sided bound", () => {
  it("is deterministic: identical payload ⇒ identical witness", () => {
    const payload = "x".repeat(5000) + JSON.stringify({ a: 1 });
    const w1 = upperBound(payload);
    const w2 = upperBound(payload);
    expect(w1).toEqual(w2);
  });

  it("reports both compressors, sorted, with min as the bound", () => {
    const w = upperBound("hello ".repeat(500));
    expect(w.measurements.map((m) => m.algorithm)).toEqual(["brotli-11", "deflate-raw-9"]);
    expect(w.upper_bound_bytes).toBe(Math.min(...w.measurements.map((m) => m.compressed_bytes)));
  });

  it("structured, repetitive DANF-style payloads certify far below raw size", () => {
    const records = Array.from({ length: 200 }, (_, i) => ({
      protocol: "DAB-TIER0-V1",
      status: "CERTIFIED",
      nonce: `sock-n${i}`,
      policy_digest: "sha256:be27d158c3f8c0fa58ba568db4ba41ca099db9d23af503958bb0a6f0fdba2405",
    }));
    const payload = JSON.stringify(records);
    const w = upperBound(payload);
    expect(w.upper_bound_bytes).toBeLessThan(0.15 * w.raw_bytes); // deeply compressible
  });

  it("cryptographically random bytes do not certify below ~raw size", () => {
    const w = upperBound(randomBytes(4096));
    expect(w.upper_bound_bytes).toBeGreaterThan(0.9 * w.raw_bytes);
  });

  it("KEYSTONE (one-sided error, demonstrated): a PRNG stream with tiny true description length still fails to certify simple", () => {
    const n = 4096;
    const stream = xorshift32Stream(0xdeadbeef, n);
    const w = upperBound(stream);
    // A complete generating program for these exact bytes is the function
    // source plus seed and length — a few hundred bytes — so the true
    // description length is far below the certified bound:
    const generatorDescriptionBytes =
      new TextEncoder().encode(xorshift32Stream.toString()).length + 8;
    expect(generatorDescriptionBytes).toBeLessThan(600);
    // ...yet general-purpose compressors cannot see it:
    expect(w.upper_bound_bytes).toBeGreaterThan(0.9 * n);
    // The monitor is conservative BY CONSTRUCTION: it cannot see true K.
    expect(w.upper_bound_bytes).toBeGreaterThan(10 * generatorDescriptionBytes);
  });
});

describe("evaluatorAnchoredBudget — policy, not derivation", () => {
  it("equals the evaluator source's own certified bound", () => {
    const fakeSource = "export function f(){return 1}\n".repeat(50);
    expect(evaluatorAnchoredBudget(fakeSource)).toBe(upperBound(fakeSource).upper_bound_bytes);
  });
});
