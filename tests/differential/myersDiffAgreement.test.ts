/**
 * Correctness + OPTIMALITY proof for the Myers diff engine.
 *
 * A diff engine is easy to get subtly wrong in ways that still "look fine" on a
 * screen — which is exactly the failure mode this glasshouse exists to prevent.
 * So the engine is checked against an independent brute-force dynamic-programming
 * oracle over randomized inputs:
 *   1. APPLYING the edit script to `a` must reproduce `b` exactly (correctness);
 *   2. the reported edit distance must EQUAL the DP minimum (optimality — Myers
 *      claims a shortest edit script, and we verify that claim rather than
 *      trusting it);
 *   3. the preimage inspector must describe real transformations of real
 *      Ghost-Ark receipts, and must never claim the canonical form is RFC 8785.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { myersDiffChars, myersDiffTokens, inspectPreimage } from "../../apps/glasshouse/lib/myersDiff";
import { canonicalize } from "../../apps/glasshouse/lib/webReceiptVerifier";

/** Independent oracle: classic O(NM) DP edit distance (insert/delete only). */
function dpEditDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

/** Reconstructs `b` from `a` by applying the edit script. */
function applyScript(ops: ReturnType<typeof myersDiffChars>["ops"]): { fromA: string; toB: string } {
  let fromA = "";
  let toB = "";
  for (const op of ops) {
    if (op.kind === "equal") { fromA += op.value; toB += op.value; }
    else if (op.kind === "delete") fromA += op.value;
    else toB += op.value;
  }
  return { fromA, toB };
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

describe("Myers diff — correctness and optimality vs a DP oracle", () => {
  it("reproduces both inputs from the edit script (hand-checked cases)", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["abc", "abc"],
      ["", "abc"],
      ["abc", ""],
      ["ABCABBA", "CBABAC"], // the classic Myers paper example
      ['{ "b": 2.0, "a": 1 }', '{"a":1,"b":2}'],
    ];
    for (const [a, b] of cases) {
      const r = myersDiffChars(a, b);
      const { fromA, toB } = applyScript(r.ops);
      expect(fromA, `reconstruct a from ${JSON.stringify(a)}`).toBe(a);
      expect(toB, `reconstruct b from ${JSON.stringify(b)}`).toBe(b);
      expect(r.truncated).toBe(false);
      expect(r.editDistance).toBe(dpEditDistance(a, b));
    }
  });

  it("matches the DP oracle's minimal edit distance over 200 randomized pairs", () => {
    const rnd = seeded(20260724);
    const alphabet = "abcde{}\":, ";
    let checked = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const la = Math.floor(rnd() * 24);
      const lb = Math.floor(rnd() * 24);
      const a = Array.from({ length: la }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      const b = Array.from({ length: lb }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      const r = myersDiffChars(a, b);
      const { fromA, toB } = applyScript(r.ops);
      expect(fromA).toBe(a);
      expect(toB).toBe(b);
      expect(r.editDistance, `D mismatch for ${JSON.stringify([a, b])}`).toBe(dpEditDistance(a, b));
      checked += 1;
    }
    expect(checked).toBe(200);
  });

  it("degrades honestly (truncated=true) instead of hanging on a pathological pair", () => {
    const a = "x".repeat(400);
    const b = "y".repeat(400);
    const r = myersDiffChars(a, b, 8); // absurdly small bound forces the fallback
    expect(r.truncated).toBe(true);
    const { fromA, toB } = applyScript(r.ops);
    expect(fromA).toBe(a);
    expect(toB).toBe(b);
  });

  it("works on token arrays (line mode), not just characters", () => {
    const a = ["line1\n", "line2\n", "line3\n"];
    const b = ["line1\n", "lineX\n", "line3\n"];
    const r = myersDiffTokens(a, b);
    expect(r.editDistance).toBe(2); // one delete + one insert
    const { fromA, toB } = applyScript(r.ops);
    expect(fromA).toBe(a.join(""));
    expect(toB).toBe(b.join(""));
  });
});

describe("preimage inspector — real Ghost-Ark payloads", () => {
  const receipt = JSON.parse(
    readFileSync(resolve(process.cwd(), "examples/sample-receipts/valid-receipt.json"), "utf-8"),
  );

  it("explains the transformation of a pretty-printed real receipt payload", () => {
    const rawPretty = JSON.stringify(receipt.payload, null, 2);
    const r = inspectPreimage(rawPretty, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    // The canonical form must be exactly what the verifier hashes.
    expect(r.canonical).toBe(canonicalize(receipt.payload));
    // Pretty-printing adds whitespace that canonicalization strips.
    expect(r.canonicalBytes).toBeLessThan(r.rawBytes);
    expect(r.transformations.some((t) => /whitespace/i.test(t))).toBe(true);
    // The edit script must reconstruct both sides.
    const { fromA, toB } = applyScript(r.diff.ops);
    expect(fromA).toBe(rawPretty);
    expect(toB).toBe(r.canonical);
  });

  it("reports key reordering and numeric re-serialization concretely", () => {
    const raw = '{"zeta":1,"alpha":2.0,"mid":1e1}';
    const r = inspectPreimage(raw, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.canonical).toBe('{"alpha":2,"mid":10,"zeta":1}');
    expect(r.transformations.some((t) => /reordered/i.test(t))).toBe(true);
    expect(r.transformations.some((t) => /2\.0 re-serialized as 2/.test(t))).toBe(true);
    expect(r.transformations.some((t) => /1e1 re-serialized as 10/.test(t))).toBe(true);
  });

  it("reports 'already canonical' rather than inventing a transformation", () => {
    const canonicalText = canonicalize(receipt.payload);
    const r = inspectPreimage(canonicalText, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.diff.editDistance).toBe(0);
    expect(r.transformations.join(" ")).toMatch(/byte-identical to the canonical form/i);
  });

  it("REGRESSION: digits inside strings are never reported as number rewrites", () => {
    // Timestamps, dotted versions and hex ids are string CONTENT, not JSON
    // numbers. An earlier build scanned raw text blindly and fabricated five
    // "re-serialized" transformations for a byte-identical payload.
    const raw = '{"id":"rct_013987f9","ts":"2026-07-07T00:00:00.000Z","ver":"50.0.0","real":2.0}';
    const r = inspectPreimage(raw, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    const joined = r.transformations.join(" ");
    for (const ghost of ["00.000", "013987", "50.0", "-07"]) {
      expect(joined, `must not invent a rewrite for ${ghost}`).not.toContain(`literal ${ghost} `);
    }
    // The one genuine number value IS reported.
    expect(joined).toMatch(/2\.0 re-serialized as 2/);
  });

  it("fails honestly on unparseable input", () => {
    const r = inspectPreimage("{ not json", canonicalize);
    expect("error" in r).toBe(true);
  });

  it("REGRESSION: never claims 'already canonical' when the bytes actually differ", () => {
    // Transformations outside the three named heuristics (nested reorder, array
    // root, escape folding, duplicate-key elision, whitespace INCREASE) used to
    // fall through to a positive assertion of byte-identity.
    const cases = [
      '{"a":{"z":1,"y":2}}',      // nested key reorder
      '[{"z":1,"a":2}]',          // array root
      '{"a":"\\u0041"}',          // escape folding
      '{"a":1,"a":2}',            // duplicate key elided by JSON.parse
      '{"a":"  "}',               // whitespace inside a string (count can rise)
    ];
    for (const raw of cases) {
      const r = inspectPreimage(raw, canonicalize);
      expect("error" in r, raw).toBe(false);
      if ("error" in r) continue;
      if (r.raw === r.canonical) continue; // genuinely identical is fine
      expect(r.transformations.join(" "), `must not claim identity for ${raw}`).not.toMatch(/byte-identical|already in canonical/i);
    }
  });

  it("REGRESSION: fuzz — never claims byte-identity while the diff shows edits", () => {
    const rnd = seeded(4242);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    let violations = 0;
    let checked = 0;
    for (let t = 0; t < 400; t += 1) {
      const keys = ["a", "z", "10", "9", "b"];
      const vals = ['1', '2.0', '"\\u0041"', '"x"', '{"z":1,"a":2}', '[1,2]'];
      const n = 1 + Math.floor(rnd() * 3);
      const body = Array.from({ length: n }, () => `"${pick(keys)}":${pick(vals)}`).join(",");
      const raw = `{${body}}`;
      let r;
      try { r = inspectPreimage(raw, canonicalize); } catch { continue; }
      if ("error" in r) continue;
      checked += 1;
      const claimsIdentity = /byte-identical|already in canonical/i.test(r.transformations.join(" "));
      if (claimsIdentity && r.raw !== r.canonical) violations += 1;
    }
    expect(checked).toBeGreaterThan(200);
    expect(violations, "claimed byte-identity while raw !== canonical").toBe(0);
  });

  it("REGRESSION: integer-like keys do not fabricate a reorder (Object.keys order bug)", () => {
    // `{"10":1,"9":2}` canonicalizes byte-identically, but Object.keys returns
    // ["9","10"] (numeric-first), which looked like a reorder.
    const raw = '{"10":1,"9":2}';
    const r = inspectPreimage(raw, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.canonical).toBe(raw);
    expect(r.diff.editDistance).toBe(0);
    expect(r.transformations.join(" ")).not.toMatch(/reordered/i);
  });

  it("REGRESSION: the reported 'before' key order is the SOURCE order, not enumeration order", () => {
    const raw = '{"b":1,"10":2,"9":3}';
    const r = inspectPreimage(raw, canonicalize);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    const msg = r.transformations.find((t) => /reordered/i.test(t)) ?? "";
    expect(msg).toContain("[b, 10, 9]"); // the actual source order
    expect(msg).not.toContain("[9, 10, b]"); // the fabricated enumeration order
  });

  it("never describes the canonical form as RFC 8785 / JCS (claim boundary)", () => {
    const src = readFileSync(resolve(process.cwd(), "apps/glasshouse/lib/myersDiff.ts"), "utf-8");
    // The only permissible mentions elsewhere are explicit disclaimers; this
    // module must not assert compliance at all.
    expect(/complies with RFC 8785|is RFC 8785|JCS[- ]compliant/i.test(src)).toBe(false);
  });
});
