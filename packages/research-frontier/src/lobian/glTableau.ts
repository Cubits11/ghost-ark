// A sound, complete, terminating decision procedure for Gödel–Löb logic (GL),
// by signed-formula tableau. Given φ it returns EITHER a closed proof tree
// (φ is a GL-theorem) OR a finite transitive-irreflexive Kripke countermodel
// (φ is refutable). The countermodel is independently re-checked by kripke.ts.
//
// The modal step is the Sambin–Valentini rule for GL: to witness a defect
// F:□A at a saturated world, build ONE successor carrying, for every T:□a in
// the world, both a (contents) and □a (persistence under transitivity), PLUS
// □A itself, and F:A. Re-asserting □A in the child is the Löb ingredient: any
// descendant that tries to defect □A again meets T:□A and closes, which both
// bounds branch length (subformula-driven termination) and realizes converse
// well-foundedness — the frame condition Löb's axiom corresponds to.
//
// No maturity annotation: total syntax→semantics procedure, no external
// assumption. Hand-checked against Löb, T, and Con(sistency); the test oracle
// pins it to the textbook GL theorem/non-theorem boundary.

import {
  type Formula,
  box,
  key,
  show,
} from "./formula";
import {
  type KripkeModel,
  isGLFrame,
  refutes,
  transitiveClosure,
} from "./kripke";

type Sign = "T" | "F";
interface Signed {
  readonly sign: Sign;
  readonly f: Formula;
}
const sk = (s: Signed): string => `${s.sign}:${key(s.f)}`;

/** A proof-tree node for the theorem (all-branches-closed) case. */
export type Proof =
  | { rule: "close"; reason: string; sequent: string }
  | { rule: "alpha"; name: string; sequent: string; sub: Proof }
  | { rule: "beta"; name: string; sequent: string; subs: Proof[] }
  | { rule: "gl-modal"; sequent: string; refuted: string; sub: Proof };

interface WorldNode {
  trueAtoms: string[];
  successors: WorldNode[];
}
type SearchResult =
  | { closed: true; proof: Proof }
  | { closed: false; world: WorldNode };

export interface DecideStats {
  nodesExplored: number;
  elapsedMs: number;
}
export type DecideResult =
  | { theorem: true; proof: Proof; stats: DecideStats }
  | {
      theorem: false;
      countermodel: KripkeModel;
      root: string;
      stats: DecideStats;
    };

const MAX_NODES = 200_000; // runaway backstop; GL termination makes this unreachable for sane inputs

function dedup(signed: Signed[]): Signed[] {
  const seen = new Set<string>();
  const out: Signed[] = [];
  for (const s of signed) {
    const k = sk(s);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

function sequentString(signed: Signed[]): string {
  return dedup(signed)
    .map(sk)
    .sort()
    .join(" , ");
}

/** First propositionally-decomposable signed formula (not atom/top/bot/box). */
function pickCompound(signed: Signed[]): number {
  return signed.findIndex((s) => {
    const k = s.f.k;
    return k !== "atom" && k !== "top" && k !== "bot" && k !== "box";
  });
}

export function decide(phi: Formula): DecideResult {
  const t0 = Date.now();
  const counter = { n: 0 };

  function search(signedIn: Signed[]): SearchResult {
    if (++counter.n > MAX_NODES) {
      throw new Error("GL tableau exceeded node budget (unexpected for GL)");
    }
    const signed = dedup(signedIn);
    const seq = sequentString(signed);

    // ---- closure ----
    const present = new Set(signed.map(sk));
    for (const s of signed) {
      const opp: Sign = s.sign === "T" ? "F" : "T";
      if (present.has(`${opp}:${key(s.f)}`)) {
        return {
          closed: true,
          proof: { rule: "close", reason: `T:${show(s.f)} and F:${show(s.f)}`, sequent: seq },
        };
      }
    }
    if (present.has("T:F")) {
      return { closed: true, proof: { rule: "close", reason: "T:⊥", sequent: seq } };
    }
    if (present.has("F:T")) {
      return { closed: true, proof: { rule: "close", reason: "F:⊤", sequent: seq } };
    }

    // ---- propositional decomposition ----
    const idx = pickCompound(signed);
    if (idx >= 0) {
      const s = signed[idx];
      const rest = signed.filter((_, i) => i !== idx);
      const a = (s.f as { a: Formula }).a;
      const b = (s.f as { b: Formula }).b;

      // alpha (non-branching)
      const alpha = (adds: Signed[], name: string): SearchResult => {
        const r = search([...rest, ...adds]);
        return r.closed
          ? { closed: true, proof: { rule: "alpha", name, sequent: seq, sub: r.proof } }
          : r;
      };
      // beta (branching): open iff ANY branch open; closed iff ALL close
      const beta = (branches: Signed[][], name: string): SearchResult => {
        const proofs: Proof[] = [];
        for (const br of branches) {
          const r = search([...rest, ...br]);
          if (!r.closed) return r;
          proofs.push(r.proof);
        }
        return { closed: true, proof: { rule: "beta", name, sequent: seq, subs: proofs } };
      };

      switch (`${s.sign}:${s.f.k}`) {
        case "T:not":
          return alpha([{ sign: "F", f: a }], "T¬");
        case "F:not":
          return alpha([{ sign: "T", f: a }], "F¬");
        case "T:and":
          return alpha([{ sign: "T", f: a }, { sign: "T", f: b }], "T∧");
        case "F:and":
          return beta([[{ sign: "F", f: a }], [{ sign: "F", f: b }]], "F∧");
        case "T:or":
          return beta([[{ sign: "T", f: a }], [{ sign: "T", f: b }]], "T∨");
        case "F:or":
          return alpha([{ sign: "F", f: a }, { sign: "F", f: b }], "F∨");
        case "T:imp":
          return beta([[{ sign: "F", f: a }], [{ sign: "T", f: b }]], "T→");
        case "F:imp":
          return alpha([{ sign: "T", f: a }, { sign: "F", f: b }], "F→");
        case "T:iff":
          return beta(
            [
              [{ sign: "T", f: a }, { sign: "T", f: b }],
              [{ sign: "F", f: a }, { sign: "F", f: b }],
            ],
            "T↔",
          );
        case "F:iff":
          return beta(
            [
              [{ sign: "T", f: a }, { sign: "F", f: b }],
              [{ sign: "F", f: a }, { sign: "T", f: b }],
            ],
            "F↔",
          );
        case "T:top":
        case "F:bot":
          return alpha([], "triv"); // removable no-op
        default:
          break;
      }
    }

    // ---- saturated: only atoms and boxes remain ----
    const trueAtoms = signed
      .filter((s) => s.sign === "T" && s.f.k === "atom")
      .map((s) => (s.f as { name: string }).name);
    const boxedT = signed
      .filter((s) => s.sign === "T" && s.f.k === "box")
      .map((s) => (s.f as { a: Formula }).a);
    const defects = signed
      .filter((s) => s.sign === "F" && s.f.k === "box")
      .map((s) => (s.f as { a: Formula }).a);

    const successors: WorldNode[] = [];
    for (const A of defects) {
      const succ: Signed[] = [
        ...boxedT.map((a) => ({ sign: "T" as const, f: a })),
        ...boxedT.map((a) => ({ sign: "T" as const, f: box(a) })),
        { sign: "T" as const, f: box(A) }, // Löb ingredient (persist □A into the child)
        { sign: "F" as const, f: A },
      ];
      const r = search(succ);
      if (r.closed) {
        // This defect cannot be witnessed ⇒ the world is unsatisfiable.
        return {
          closed: true,
          proof: { rule: "gl-modal", sequent: seq, refuted: `□${show(A)}`, sub: r.proof },
        };
      }
      successors.push(r.world);
    }
    return { closed: false, world: { trueAtoms, successors } };
  }

  const result = search([{ sign: "F", f: phi }]);
  const stats: DecideStats = { nodesExplored: counter.n, elapsedMs: Date.now() - t0 };

  if (result.closed) {
    return { theorem: true, proof: result.proof, stats };
  }
  const { model, rootId } = buildModel(result.world);
  return { theorem: false, countermodel: model, root: rootId, stats };
}

/** Convenience: boolean validity. */
export function isTheorem(phi: Formula): boolean {
  return decide(phi).theorem;
}

/** Materialize a WorldNode tree into a transitive, irreflexive Kripke model. */
function buildModel(root: WorldNode): { model: KripkeModel; rootId: string } {
  let counter = 0;
  const worlds: string[] = [];
  const treeEdges: Array<[string, string]> = [];
  const valuation: Record<string, string[]> = {};
  const assign = (node: WorldNode): string => {
    const id = `w${counter++}`;
    worlds.push(id);
    valuation[id] = [...node.trueAtoms].sort();
    for (const succ of node.successors) treeEdges.push([id, assign(succ)]);
    return id;
  };
  const rootId = assign(root);
  const edges = transitiveClosure(treeEdges);
  return { model: { worlds, edges, valuation }, rootId };
}

/**
 * Self-checking wrapper: on a "not a theorem" verdict, re-run the independent
 * model checker to CONFIRM the countermodel is a GL frame and actually refutes
 * φ. Throws if the prover and the semantics ever disagree — a fake refutation
 * cannot escape this gate. Callers that mint receipts should use this.
 */
export function decideChecked(phi: Formula): DecideResult {
  const r = decide(phi);
  if (!r.theorem) {
    if (!isGLFrame(r.countermodel)) {
      throw new Error("internal: countermodel is not a transitive-irreflexive frame");
    }
    if (!refutes(r.countermodel, r.root, phi)) {
      throw new Error("internal: countermodel does not refute the formula");
    }
  }
  return r;
}
