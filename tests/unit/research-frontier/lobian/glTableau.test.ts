import { describe, it, expect } from "vitest";
import {
  atom,
  box,
  dia,
  imp,
  and,
  or,
  not,
  iff,
  BOT,
  TOP,
  show,
} from "../../../../packages/research-frontier/src/lobian/formula";
import {
  decide,
  decideChecked,
  isTheorem,
} from "../../../../packages/research-frontier/src/lobian/glTableau";
import {
  isGLFrame,
  refutes,
} from "../../../../packages/research-frontier/src/lobian/kripke";

const p = atom("p");
const q = atom("q");

// The textbook GL boundary. If any of these flip, the prover is wrong.
const THEOREMS = {
  "K: □(p→q)→(□p→□q)": imp(box(imp(p, q)), imp(box(p), box(q))),
  "Löb: □(□p→p)→□p": imp(box(imp(box(p), p)), box(p)),
  "4 (derivable in GL): □p→□□p": imp(box(p), box(box(p))),
  "necessitated tautology: □(p→p)": box(imp(p, p)),
  "□ distributes over ∧: □(p∧q)↔(□p∧□q)": iff(box(and(p, q)), and(box(p), box(q))),
  "formalized G2: □(□⊥→⊥)→□⊥": imp(box(imp(box(BOT), BOT)), box(BOT)),
  "□⊥→□p (vacuous at endpoints)": imp(box(BOT), box(p)),
  "□(p↔q)→(□p↔□q)": imp(box(iff(p, q)), iff(box(p), box(q))),
};

const NON_THEOREMS = {
  "T / reflexivity: □p→p": imp(box(p), p),
  "D / seriality: □p→◇p": imp(box(p), dia(p)),
  "B: p→□◇p": imp(p, box(dia(p))),
  "Con (¬ provable): □⊥→⊥": imp(box(BOT), BOT),
  "converse-4: □□p→□p": imp(box(box(p)), box(p)),
  "◇⊤ (seriality restated)": dia(TOP),
  "p→□p": imp(p, box(p)),
};

describe("GL tableau — theorems (must close with a proof)", () => {
  for (const [name, phi] of Object.entries(THEOREMS)) {
    it(name, () => {
      const r = decide(phi);
      expect(r.theorem, `${show(phi)} should be a GL-theorem`).toBe(true);
      if (r.theorem) expect(r.proof).toBeDefined();
    });
  }
});

describe("GL tableau — non-theorems (must yield a valid countermodel)", () => {
  for (const [name, phi] of Object.entries(NON_THEOREMS)) {
    it(name, () => {
      const r = decide(phi);
      expect(r.theorem, `${show(phi)} should NOT be a GL-theorem`).toBe(false);
      if (!r.theorem) {
        // The frame is a legitimate GL frame ...
        expect(isGLFrame(r.countermodel), "countermodel must be transitive+irreflexive").toBe(true);
        // ... and it actually falsifies φ at the root (independent semantics).
        expect(refutes(r.countermodel, r.root, phi), "countermodel must refute φ").toBe(true);
        // decideChecked would throw if either failed:
        expect(() => decideChecked(phi)).not.toThrow();
      }
    });
  }
});

describe("GL tableau — structural sanity", () => {
  it("does not prove reflexivity but does prove Löb (the crux distinction)", () => {
    expect(isTheorem(imp(box(p), p))).toBe(false); // □p→p
    expect(isTheorem(imp(box(imp(box(p), p)), box(p)))).toBe(true); // Löb
  });

  it("consistency is unprovable but its Löb-conditional is a theorem (Gödel G2 shape)", () => {
    // ¬□⊥ (= system is consistent) is NOT a theorem ...
    expect(isTheorem(not(box(BOT)))).toBe(false);
    // ... yet □(□⊥→⊥)→□⊥ (= □Con→□⊥) IS: proving consistency would prove ⊥.
    expect(isTheorem(imp(box(imp(box(BOT), BOT)), box(BOT)))).toBe(true);
  });

  it("is a decision procedure: every formula gets a definite verdict, fast", () => {
    for (const phi of [...Object.values(THEOREMS), ...Object.values(NON_THEOREMS)]) {
      const r = decide(phi);
      expect(typeof r.theorem).toBe("boolean");
      expect(r.stats.nodesExplored).toBeGreaterThan(0);
      expect(r.stats.elapsedMs).toBeLessThan(1000);
    }
  });

  it("law of excluded middle and modus-ponens shapes are theorems", () => {
    expect(isTheorem(or(p, not(p)))).toBe(true);
    expect(isTheorem(imp(and(p, imp(p, q)), q))).toBe(true);
  });
});
