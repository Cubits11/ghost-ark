// Exact two-sided oracle for achievable joint-failure mass.
//
// A model checker for the Fréchet calculus: given k failure marginals and a
// regime (a predicate saying which joint-failure patterns are structurally
// feasible), it computes — by exact linear programming over the 2^k atomic
// events — the true minimum and maximum achievable P(⋃Fᵢ) and P(⋂Fᵢ). The
// analytic Fréchet bounds in indexedFailureSystem.ts are asserted against THIS;
// if a claimed bound is ever violated by the exact LP, the tests fail. Nothing
// here shares code with the analytic bounds, so a bug in one cannot hide a bug
// in the other.
//
// The solver is a self-contained two-phase primal simplex with Bland's rule
// (anti-cycling ⇒ guaranteed termination). Inputs are small (k ≤ ~8, so ≤ 256
// atoms); a numeric tolerance of 1e-9 is used and documented.
//
// No maturity annotation: pure computation, no external assumption.

const EPS = 1e-9;

export interface LPResult {
  status: "optimal" | "infeasible" | "unbounded";
  value: number;
  x: number[];
}

/** minimize c·x subject to A x = b, x ≥ 0. Two-phase simplex, Bland's rule. */
export function linprogMin(cIn: number[], Ain: number[][], bIn: number[]): LPResult {
  const m = Ain.length;
  const n = cIn.length;
  const A = Ain.map((r) => r.slice());
  const b = bIn.slice();
  for (let i = 0; i < m; i++) {
    if (b[i] < 0) {
      for (let j = 0; j < n; j++) A[i][j] = -A[i][j];
      b[i] = -b[i];
    }
  }
  // Tableau columns: n structural, m artificial, 1 rhs.
  const cols = n + m;
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(cols + 1).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    row[cols] = b[i];
    T.push(row);
  }
  const basis: number[] = [];
  for (let i = 0; i < m; i++) basis.push(n + i);

  const optimize = (cost: number[], barred: Set<number>): "optimal" | "unbounded" => {
    for (;;) {
      // reduced cost of column j = cost[j] - Σ_i cost[basis[i]]·T[i][j]
      let entering = -1;
      for (let j = 0; j < cols; j++) {
        if (barred.has(j) || basis.includes(j)) continue;
        let rc = cost[j];
        for (let i = 0; i < m; i++) rc -= cost[basis[i]] * T[i][j];
        if (rc < -EPS) {
          entering = j; // Bland: smallest eligible index
          break;
        }
      }
      if (entering === -1) return "optimal";
      // ratio test
      let leaving = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][entering] > EPS) {
          const ratio = T[i][cols] / T[i][entering];
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && (leaving === -1 || basis[i] < basis[leaving]))) {
            best = ratio;
            leaving = i;
          }
        }
      }
      if (leaving === -1) return "unbounded";
      // pivot on (leaving, entering)
      const piv = T[leaving][entering];
      for (let j = 0; j <= cols; j++) T[leaving][j] /= piv;
      for (let i = 0; i < m; i++) {
        if (i === leaving) continue;
        const f = T[i][entering];
        if (Math.abs(f) < EPS) continue;
        for (let j = 0; j <= cols; j++) T[i][j] -= f * T[leaving][j];
      }
      basis[leaving] = entering;
    }
  };

  // Phase 1: minimize sum of artificials.
  const c1 = new Array(cols).fill(0);
  for (let i = 0; i < m; i++) c1[n + i] = 1;
  optimize(c1, new Set());
  let phase1 = 0;
  for (let i = 0; i < m; i++) phase1 += c1[basis[i]] * T[i][cols];
  if (phase1 > 1e-7) return { status: "infeasible", value: 0, x: [] };

  // Phase 2: real cost on structural vars; artificials barred from re-entering.
  const c2 = new Array(cols).fill(0);
  for (let j = 0; j < n; j++) c2[j] = cIn[j];
  const barred = new Set<number>();
  for (let i = 0; i < m; i++) barred.add(n + i);
  const status = optimize(c2, barred);
  if (status === "unbounded") return { status: "unbounded", value: -Infinity, x: [] };

  let value = 0;
  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) {
    value += c2[basis[i]] * T[i][cols];
    if (basis[i] < n) x[basis[i]] = Math.max(0, T[i][cols]);
  }
  return { status: "optimal", value, x };
}

export type AtomFeasible = (failMask: number, k: number) => boolean;

export interface ExactBounds {
  feasible: boolean;
  /** achievable [min, max] of P(⋃Fᵢ) under the regime. */
  union: [number, number];
  /** achievable [min, max] of P(⋂Fᵢ) under the regime. */
  intersection: [number, number];
  atoms: number; // number of structurally feasible atoms
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 1e9) / 1e9));

/**
 * Exact achievable bounds on union/intersection failure mass for the given
 * marginals under a regime, by LP over the feasible atoms.
 */
export function exactBounds(
  k: number,
  marginals: number[],
  atomFeasible: AtomFeasible,
): ExactBounds {
  if (marginals.length !== k) throw new Error("marginals length must equal k");
  const atoms: number[] = [];
  for (let mask = 0; mask < 1 << k; mask++) if (atomFeasible(mask, k)) atoms.push(mask);
  const n = atoms.length;

  // constraints: Σq = 1, and for each i: Σ_{atom has bit i} q = p_i
  const A: number[][] = [new Array(n).fill(1)];
  const b: number[] = [1];
  for (let i = 0; i < k; i++) {
    A.push(atoms.map((mask) => ((mask >> i) & 1 ? 1 : 0)));
    b.push(marginals[i]);
  }

  if (linprogMin(new Array(n).fill(0), A, b).status === "infeasible") {
    return { feasible: false, union: [NaN, NaN], intersection: [NaN, NaN], atoms: n };
  }

  const full = (1 << k) - 1;
  const notZero = atoms.map((mask) => (mask !== 0 ? 1 : 0));
  const isFull = atoms.map((mask) => (mask === full ? 1 : 0));
  const maximize = (c: number[]): number => -linprogMin(c.map((v) => -v), A, b).value;
  const minimize = (c: number[]): number => linprogMin(c, A, b).value;

  return {
    feasible: true,
    union: [clamp01(minimize(notZero)), clamp01(maximize(notZero))],
    intersection: [clamp01(minimize(isFull)), clamp01(maximize(isFull))],
    atoms: n,
  };
}
