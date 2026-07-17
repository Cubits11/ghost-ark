// Modal propositional formulas for Gödel–Löb provability logic (GL).
//
// Read □φ as "it is provable (in the fixed base theory) that φ". GL is the
// provability logic of PA: it is decidable, and sound & complete with respect
// to FINITE, TRANSITIVE, IRREFLEXIVE Kripke frames. This module is pure syntax;
// the decision procedure lives in glTableau.ts and the semantics in kripke.ts.
//
// No maturity annotation: this file is total, dependency-free syntax with no
// cryptographic or environmental assumption to declare.

export type Formula =
  | { readonly k: "atom"; readonly name: string }
  | { readonly k: "top" }
  | { readonly k: "bot" }
  | { readonly k: "not"; readonly a: Formula }
  | { readonly k: "and"; readonly a: Formula; readonly b: Formula }
  | { readonly k: "or"; readonly a: Formula; readonly b: Formula }
  | { readonly k: "imp"; readonly a: Formula; readonly b: Formula }
  | { readonly k: "iff"; readonly a: Formula; readonly b: Formula }
  | { readonly k: "box"; readonly a: Formula };

// ---- smart constructors -----------------------------------------------------
export const atom = (name: string): Formula => ({ k: "atom", name });
export const TOP: Formula = { k: "top" };
export const BOT: Formula = { k: "bot" };
export const not = (a: Formula): Formula => ({ k: "not", a });
export const and = (a: Formula, b: Formula): Formula => ({ k: "and", a, b });
export const or = (a: Formula, b: Formula): Formula => ({ k: "or", a, b });
export const imp = (a: Formula, b: Formula): Formula => ({ k: "imp", a, b });
export const iff = (a: Formula, b: Formula): Formula => ({ k: "iff", a, b });
export const box = (a: Formula): Formula => ({ k: "box", a });
// Diamond is defined, not primitive: ◇φ ≡ ¬□¬φ. Keeping one modal primitive
// makes the tableau rules exhaustive by construction.
export const dia = (a: Formula): Formula => not(box(not(a)));

// ---- deterministic structural key (equality / dedup) ------------------------
// A canonical, injective string. Used for set membership, closure detection,
// and as the stable ordering key in the receipt's deterministic normal form.
export function key(f: Formula): string {
  switch (f.k) {
    case "atom":
      return `p(${f.name})`;
    case "top":
      return "T";
    case "bot":
      return "F";
    case "not":
      return `~(${key(f.a)})`;
    case "and":
      return `&(${key(f.a)},${key(f.b)})`;
    case "or":
      return `|(${key(f.a)},${key(f.b)})`;
    case "imp":
      return `>(${key(f.a)},${key(f.b)})`;
    case "iff":
      return `=(${key(f.a)},${key(f.b)})`;
    case "box":
      return `[](${key(f.a)})`;
  }
}

export const eq = (x: Formula, y: Formula): boolean => key(x) === key(y);

// ---- human-readable rendering ----------------------------------------------
export function show(f: Formula): string {
  switch (f.k) {
    case "atom":
      return f.name;
    case "top":
      return "⊤";
    case "bot":
      return "⊥";
    case "not":
      return `¬${show(f.a)}`;
    case "and":
      return `(${show(f.a)} ∧ ${show(f.b)})`;
    case "or":
      return `(${show(f.a)} ∨ ${show(f.b)})`;
    case "imp":
      return `(${show(f.a)} → ${show(f.b)})`;
    case "iff":
      return `(${show(f.a)} ↔ ${show(f.b)})`;
    case "box":
      return `□${show(f.a)}`;
  }
}

// ---- subformulas (finite; underwrites tableau termination) ------------------
export function subformulas(f: Formula, acc = new Map<string, Formula>()): Map<string, Formula> {
  acc.set(key(f), f);
  switch (f.k) {
    case "not":
    case "box":
      subformulas(f.a, acc);
      break;
    case "and":
    case "or":
    case "imp":
    case "iff":
      subformulas(f.a, acc);
      subformulas(f.b, acc);
      break;
    default:
      break;
  }
  return acc;
}

/** Modal depth — the longest chain of nested boxes. Bounds countermodel height. */
export function modalDepth(f: Formula): number {
  switch (f.k) {
    case "atom":
    case "top":
    case "bot":
      return 0;
    case "not":
      return modalDepth(f.a);
    case "box":
      return 1 + modalDepth(f.a);
    default:
      return Math.max(modalDepth(f.a), modalDepth(f.b));
  }
}
