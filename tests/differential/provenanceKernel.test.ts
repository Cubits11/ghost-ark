/**
 * THE PROVENANCE KERNEL PROBLEM — an executable statement of the result.
 *
 * A canonicalizer C maps documents to the bytes that get signed. Its KERNEL is
 * the set of distinct documents that C maps to the same bytes:
 *
 *     ker(C) = { (x, y) : x != y, C(x) = C(y) }
 *
 * Every canonicalizer has a kernel BY DESIGN — `{"a":1,"b":2}` and
 * `{"b":2,"a":1}` must sign identically, or canonicalization would be pointless.
 * The kernel splits in two:
 *
 *     INTENDED   I  = { (x,y) in ker(C) : every consumer agrees x and y mean the same }
 *     UNINTENDED U  = ker(C) \ I
 *
 * A pair in U is a signature that covers two documents which downstream systems
 * read DIFFERENTLY. One signature, two meanings — and the verifier, by
 * construction, cannot tell you which one was authorised.
 *
 * SOUNDNESS is `U = {}`. The claim under test is that soundness is not a
 * permanent property: it is indexed by the document alphabet and parser
 * semantics in force when it was checked, both of which grow over time. This
 * file demonstrates the phenomenon on Ghost-Ark's own canonicalizer rather than
 * asserting it, and pins the members it finds so they cannot silently change.
 *
 * SCOPE. These tests characterise; they do not claim Ghost-Ark is broken. The
 * receipt path hashes bytes the gateway itself produced, which closes most of
 * this. The point is that the closure is an ARGUMENT ABOUT CALLERS, not a
 * property of the canonicalizer — and an argument about callers is exactly what
 * a static soundness proof cannot carry forward.
 */

import { describe, it, expect } from "vitest";
import { canonicalize } from "../../apps/glasshouse/lib/webReceiptVerifier";

/** Canonicalize a document given as SOURCE TEXT (the form an auditor pastes). */
function canonText(text: string): string {
  return canonicalize(JSON.parse(text));
}

function collide(a: string, b: string): boolean {
  return canonText(a) === canonText(b);
}

describe("Provenance Kernel — intended members (these MUST collide)", () => {
  it("key order is immaterial: that is the whole point of canonicalization", () => {
    expect(collide('{"a":1,"b":2}', '{"b":2,"a":1}')).toBe(true);
  });

  it("insignificant whitespace is immaterial", () => {
    expect(collide('{"a":1}', '{  "a" :   1  }')).toBe(true);
  });

  it("a string escape and its literal denote the same string", () => {
    expect(collide('{"a":"\\u0041"}', '{"a":"A"}')).toBe(true);
  });
});

describe("Provenance Kernel — UNINTENDED members (one signature, two readings)", () => {
  it("DUPLICATE KEYS: the signed value depends on parser policy, which is not universal", () => {
    // RFC 8259 leaves duplicate names undefined. JS keeps the LAST; other
    // stacks keep the first, error, or collect both. The signature covers the
    // last-wins reading only, while a first-wins consumer sees {"a":1}.
    expect(collide('{"a":1,"a":2}', '{"a":2}')).toBe(true);
    expect(canonText('{"a":1,"a":2}')).toBe('{"a":2}');
    // The document a first-wins parser sees is NOT what was signed:
    expect(canonText('{"a":1,"a":2}')).not.toBe(canonText('{"a":1}'));
  });

  it("INTEGERS ABOVE 2^53: distinct amounts sign identically", () => {
    // The classic financial case. Both texts name different integers; IEEE-754
    // double parsing maps them to the same value before canonicalization sees
    // them, so one signature authorises both.
    expect(collide('{"amount":10000000000000001}', '{"amount":10000000000000000}')).toBe(true);
    expect(canonText('{"amount":10000000000000001}')).toBe('{"amount":10000000000000000}');
  });

  it("NUMERIC SPELLING: exponent, trailing zero and negative zero all fold", () => {
    expect(collide('{"a":1e2}', '{"a":100}')).toBe(true);
    expect(collide('{"a":1.0}', '{"a":1}')).toBe(true);
    expect(collide('{"a":-0}', '{"a":0}')).toBe(true);
  });
});

describe("Provenance Kernel — the structural result", () => {
  it("KERNEL MONOTONICITY: enlarging the document set can only enlarge the kernel", () => {
    // A colliding pair over a restricted alphabet is still a colliding pair
    // over any superset, because C restricted to the smaller set is the same
    // function. Demonstrated concretely: an ASCII-only pair keeps colliding
    // when non-ASCII documents are admitted.
    const asciiPair: [string, string] = ['{"a":1,"b":2}', '{"b":2,"a":1}'];
    expect(collide(...asciiPair)).toBe(true);
    // Admitting a wider alphabet does not repair it, and adds candidates:
    const widerPair: [string, string] = ['{"\\u00e9":1,"b":2}', '{"b":2,"\\u00e9":1}'];
    expect(collide(...widerPair)).toBe(true);
    expect(collide(...asciiPair)).toBe(true);
  });

  it("NON-PERSISTENCE: soundness over a sub-alphabet does not imply soundness over a superset", () => {
    // Restrict attention to documents whose values are integers < 2^53 and whose
    // keys are unique and ASCII. Over THAT set, the unintended members exercised
    // above are absent — a soundness proof would succeed.
    const restricted = ['{"a":1}', '{"b":2}', '{"a":1,"b":2}', '{"b":2,"a":1}'];
    const unintendedInRestricted = restricted.flatMap((x, i) =>
      restricted.slice(i + 1).filter((y) => canonText(x) === canonText(y) && !sameMeaningByConstruction(x, y)),
    );
    expect(unintendedInRestricted).toHaveLength(0);

    // Enlarge the set by ONE admissible feature — integers beyond 2^53 — and an
    // unintended member appears immediately. The proof did not become wrong; its
    // DOMAIN moved out from under it.
    expect(collide('{"amount":10000000000000001}', '{"amount":10000000000000000}')).toBe(true);
  });

  it("a soundness claim without a declared domain is not merely incomplete — it is unindexed", () => {
    // This is the practical corollary. Ghost-Ark states its canonicalization is
    // NOT RFC 8785 and pins nothing about Unicode version or numeric domain, so
    // any soundness statement must carry that scope explicitly.
    const src = readCanonicalizerSource();
    expect(src, "the canonicalizer must not claim an unqualified standard").not.toMatch(/complies with RFC 8785|is RFC 8785/i);
  });
});

/** Pairs that are equal purely by key reordering are intended by construction. */
function sameMeaningByConstruction(x: string, y: string): boolean {
  const kx = Object.keys(JSON.parse(x)).sort().join(",");
  const ky = Object.keys(JSON.parse(y)).sort().join(",");
  return kx === ky;
}

function readCanonicalizerSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), "apps/glasshouse/lib/webReceiptVerifier.ts"), "utf-8");
}
