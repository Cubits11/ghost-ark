import { describe, it, expect } from "vitest";
import { atom, box, imp, BOT } from "../../../../packages/research-frontier/src/lobian/formula";
import {
  type KripkeModel,
  satisfies,
  successors,
  isIrreflexive,
  isTransitive,
  isGLFrame,
  transitiveClosure,
  validOn,
  refutes,
} from "../../../../packages/research-frontier/src/lobian/kripke";

const p = atom("p");

describe("Kripke model checker", () => {
  it("□ is vacuously true at an endpoint (no successors)", () => {
    const m: KripkeModel = { worlds: ["w0"], edges: [], valuation: { w0: [] } };
    expect(successors(m, "w0")).toEqual([]);
    expect(satisfies(m, "w0", box(p))).toBe(true); // □p vacuously true
    expect(satisfies(m, "w0", p)).toBe(false); // p false
    expect(satisfies(m, "w0", imp(box(p), p))).toBe(false); // □p→p is FALSE here
  });

  it("□φ requires φ at every successor", () => {
    const m: KripkeModel = {
      worlds: ["w0", "w1", "w2"],
      edges: [
        ["w0", "w1"],
        ["w0", "w2"],
      ],
      valuation: { w0: [], w1: ["p"], w2: [] },
    };
    expect(satisfies(m, "w0", box(p))).toBe(false); // w2 lacks p
    const m2: KripkeModel = { ...m, valuation: { w0: [], w1: ["p"], w2: ["p"] } };
    expect(satisfies(m2, "w0", box(p))).toBe(true);
  });

  it("□⊥ is true exactly at endpoints", () => {
    const m: KripkeModel = {
      worlds: ["w0", "w1"],
      edges: [["w0", "w1"]],
      valuation: { w0: [], w1: [] },
    };
    expect(satisfies(m, "w0", box(BOT))).toBe(false); // has a successor
    expect(satisfies(m, "w1", box(BOT))).toBe(true); // endpoint
  });
});

describe("frame properties", () => {
  it("detects reflexive edges", () => {
    const refl: KripkeModel = { worlds: ["w0"], edges: [["w0", "w0"]], valuation: { w0: [] } };
    expect(isIrreflexive(refl)).toBe(false);
    expect(isGLFrame(refl)).toBe(false);
  });

  it("detects transitivity violations", () => {
    const nonTrans: KripkeModel = {
      worlds: ["a", "b", "c"],
      edges: [
        ["a", "b"],
        ["b", "c"],
      ],
      valuation: { a: [], b: [], c: [] },
    };
    expect(isTransitive(nonTrans)).toBe(false); // missing a→c
    const closed = { ...nonTrans, edges: transitiveClosure(nonTrans.edges) };
    expect(isTransitive(closed)).toBe(true);
    expect(isIrreflexive(closed)).toBe(true); // closing a DAG keeps it irreflexive
    expect(isGLFrame(closed)).toBe(true);
  });

  it("transitive closure is idempotent", () => {
    const edges: Array<[string, string]> = [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ];
    const once = transitiveClosure(edges);
    const twice = transitiveClosure(once);
    expect(new Set(once.map((e) => e.join(" ")))).toEqual(new Set(twice.map((e) => e.join(" "))));
  });
});

describe("validity / refutation helpers", () => {
  it("validOn checks every world", () => {
    const chain: KripkeModel = {
      worlds: ["w0", "w1"],
      edges: transitiveClosure([["w0", "w1"]]),
      valuation: { w0: ["p"], w1: ["p"] },
    };
    expect(validOn(chain, p)).toBe(true);
    expect(validOn({ ...chain, valuation: { w0: ["p"], w1: [] } }, p)).toBe(false);
  });

  it("refutes requires a GL frame AND local falsity", () => {
    const endpoint: KripkeModel = { worlds: ["w0"], edges: [], valuation: { w0: [] } };
    expect(refutes(endpoint, "w0", imp(box(p), p))).toBe(true); // □p→p false, frame OK
    const reflexive: KripkeModel = { worlds: ["w0"], edges: [["w0", "w0"]], valuation: { w0: [] } };
    expect(refutes(reflexive, "w0", imp(box(p), p))).toBe(false); // not a GL frame
  });
});
