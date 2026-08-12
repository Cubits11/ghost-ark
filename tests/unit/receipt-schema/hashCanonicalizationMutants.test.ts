import { describe, expect, it } from "vitest";

import {
  canonicalSha256Hex,
  canonicalize,
  claimIdFromPayload,
  evidenceObjectId,
  lineageEventIdFromPayload,
  receiptIdFromPayload
} from "../../../packages/receipt-schema/src/hashCanonicalization";

/**
 * Tests written to kill specific surviving mutants from experiment E10.
 *
 * `hashCanonicalization.ts` scored 88.2% (149/169) with 20 survivors and 8
 * mutants executed by no test at all. The gaps are not in the parts that receive
 * the most attention — encoding, digesting — but in the boundary predicates the
 * canonical form actually depends on: which values count as plain objects, how
 * keys are ordered, and how negative zero is written.
 *
 * The starkest finding: `evidenceObjectId`, `claimIdFromPayload`,
 * `lineageEventIdFromPayload`, and `receiptIdFromPayload` are exported identity
 * functions in the receipt trust kernel and were referenced by **no test in the
 * repository**. Their mutants were reported as NoCoverage, not Survived — the
 * suite was not weak there, it was absent.
 */

describe("E10 survivors: canonical key ordering", () => {
  it("sorts object keys rather than preserving insertion order", () => {
    // Kills the ConditionalExpression mutants at line 27
    // (`left < right ? -1 : left > right ? 1 : 0`). A comparator that always
    // returns -1 leaves V8's sort in insertion order, which is indistinguishable
    // from correct output whenever the test fixture is already sorted. Every
    // fixture here is deliberately NOT in sorted order.
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, m: 2, a: 3 })).toBe('{"a":3,"m":2,"z":1}');
  });

  it("gives the same canonical form regardless of the order keys were written in", () => {
    // The property receipt identity actually depends on: two documents that
    // differ only in key order must produce one digest.
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalSha256Hex({ x: 1, y: 2, z: 3 })).toBe(canonicalSha256Hex({ z: 3, y: 2, x: 1 }));
  });

  it("orders keys by UTF-16 code unit, not by locale", () => {
    // A locale-aware comparator would sort "Z" after "a"; UTF-16 order puts
    // uppercase first. Canonicalization must not depend on the host locale.
    expect(canonicalize({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}');
  });

  it("sorts nested object keys too", () => {
    expect(canonicalize({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });
});

describe("E10 survivors: negative zero is normalized", () => {
  it("writes -0 as 0", () => {
    // Kills the UnaryOperator mutant at line 66 (`Object.is(value, -0)` ->
    // `Object.is(value, +0)`). With the mutant, EVERY zero takes the "0" branch
    // and the behavior is identical -- unless a test pins that -0 and 0 share a
    // canonical form, which is E1's `negative-zero` class.
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize({ v: -0 })).toBe(canonicalize({ v: 0 }));
  });

  it("does not normalize other negative numbers", () => {
    // Negative control: the assertions above must not pass by stripping signs.
    expect(canonicalize(-1)).toBe("-1");
    expect(canonicalize(-0.5)).toBe("-0.5");
  });
});

describe("E10 survivors: the plain-object boundary", () => {
  it("encodes an array as an array, not as an index-keyed object", () => {
    // Kills the `Array.isArray(value)` mutants at line 18. Without that clause an
    // array satisfies assertPlainObject and would be emitted as {"0":..,"1":..}.
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalize({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it("preserves array order, which is semantic", () => {
    // Arrays must NOT be sorted. Key order is normalized; element order is data.
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([2, 1])).not.toBe(canonicalize([1, 2]));
  });

  it("rejects a host-language object that is not a plain JSON object", () => {
    // Kills the prototype-check mutant at line 23. This is the rule AGENTS.md
    // states as "reject host-language non-JSON objects before signing": a class
    // instance carries a prototype whose methods never survive canonicalization,
    // so signing it would sign something other than what the caller believes.
    class Holder {
      constructor(public value: number) {}
    }
    expect(() => canonicalize(new Holder(1))).toThrow();
    expect(() => canonicalize({ nested: new Holder(1) })).toThrow();
    expect(() => canonicalize(new Map([["a", 1]]))).toThrow();
    expect(() => canonicalize(new Date(0))).toThrow();
  });

  it("accepts a null-prototype object, which carries no host behavior", () => {
    // The other half of the same predicate: `prototype === null` is explicitly
    // allowed, so a test that only asserted rejection would let the mutant that
    // drops this clause survive.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.b = 1;
    bare.a = 2;
    expect(canonicalize(bare)).toBe('{"a":2,"b":1}');
  });

  it("rejects non-finite numbers", () => {
    // Kills the ObjectLiteral/StringLiteral mutants at line 63 by asserting the
    // throw actually happens for each non-finite value.
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/u);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/u);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(/non-finite/u);
  });
});

describe("E10 no-coverage: the exported identity functions", () => {
  // These four are exported from the receipt trust kernel and were referenced by
  // NO test in the repository. Their mutants were reported as NoCoverage: the
  // suite was not weak here, it was silent.
  const payload = { subject: "acme", value: 42 };

  const idFunctions: ReadonlyArray<{ name: string; prefix: string; fn: (value: unknown) => string }> = [
    { name: "evidenceObjectId", prefix: "ev_", fn: evidenceObjectId },
    { name: "receiptIdFromPayload", prefix: "rct_", fn: receiptIdFromPayload },
    { name: "claimIdFromPayload", prefix: "clm_", fn: claimIdFromPayload },
    { name: "lineageEventIdFromPayload", prefix: "lin_", fn: lineageEventIdFromPayload }
  ];

  for (const entry of idFunctions) {
    it(`${entry.name} carries its prefix and the canonical digest`, () => {
      const id = entry.fn(payload);
      expect(id.startsWith(entry.prefix), `${entry.name} must be prefixed ${entry.prefix}`).toBe(true);
      // The suffix must BE the canonical digest, not merely look like one --
      // otherwise a mutant could return a constant and still pass a shape check.
      expect(id.slice(entry.prefix.length)).toBe(canonicalSha256Hex(payload));
    });

    it(`${entry.name} is stable under key reordering`, () => {
      expect(entry.fn({ subject: "acme", value: 42 })).toBe(entry.fn({ value: 42, subject: "acme" }));
    });

    it(`${entry.name} changes when the payload changes`, () => {
      expect(entry.fn(payload)).not.toBe(entry.fn({ ...payload, value: 43 }));
    });
  }

  it("gives different namespaces the same digest under different prefixes", () => {
    // The prefixes are namespaces over one digest. If two of them ever collided
    // entirely, an evidence id and a claim id would be interchangeable.
    const ids = idFunctions.map((entry) => entry.fn(payload));
    expect(new Set(ids).size, "each namespace must yield a distinct id").toBe(ids.length);
    const digests = idFunctions.map((entry, index) => ids[index]?.slice(entry.prefix.length));
    expect(new Set(digests).size, "all four wrap the same canonical digest").toBe(1);
  });
});
