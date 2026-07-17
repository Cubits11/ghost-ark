export enum Regime {
    SPATIAL_EXCHANGEABILITY = "SPATIAL_EXCHANGEABILITY",
    TEMPORAL_STOPPING = "TEMPORAL_STOPPING"
}

export enum LpStatus {
    OPTIMAL = "OPTIMAL",
    INFEASIBLE = "INFEASIBLE",
    UNBOUNDED = "UNBOUNDED",
    EVALUATION_UNDECIDABLE = "EVALUATION_UNDECIDABLE"
}

export interface Bounds {
    min: number;
    max: number;
    status: LpStatus;
}

export interface ExactBoundsResult {
    union: Bounds;
    intersection: Bounds;
}

const EPS = 1e-9;

class SimplexSolver {
    public tableau: number[][];
    public rhs: number[];
    public basis: number[];
    public numStructurals: number;
    public numArtificials: number;
    public m: number;

    constructor(A: number[][], b: number[]) {
        this.m = b.length;
        this.numStructurals = A[0].length;
        this.numArtificials = this.m;
        
        this.tableau = [];
        this.rhs = [...b];
        this.basis = [];

        // Initialize tableau: A | I
        for (let i = 0; i < this.m; i++) {
            const row = new Array(this.numStructurals + this.numArtificials).fill(0);
            for (let j = 0; j < this.numStructurals; j++) {
                row[j] = A[i][j];
            }
            row[this.numStructurals + i] = 1; // Artificial variable
            this.tableau.push(row);
            this.basis.push(this.numStructurals + i);
        }
    }

    public solve(costs: number[], maximize: boolean, maxIterations: number = 1000): LpStatus {
        // Phase 1: Minimize sum of artificial variables
        const phase1Costs = new Array(this.numStructurals + this.numArtificials).fill(0);
        for (let i = 0; i < this.numArtificials; i++) {
            phase1Costs[this.numStructurals + i] = 1;
        }

        const p1Status = this.runSimplex(phase1Costs, true, maxIterations);
        if (p1Status === LpStatus.UNBOUNDED) return LpStatus.UNBOUNDED;
        if (p1Status === LpStatus.EVALUATION_UNDECIDABLE) return LpStatus.EVALUATION_UNDECIDABLE;
        
        let artSum = 0;
        for (let i = 0; i < this.m; i++) {
            if (this.basis[i] >= this.numStructurals) {
                artSum += this.rhs[i];
            }
        }
        
        // If the sum of artificials > 0, the original problem is infeasible
        if (artSum > EPS) {
            return LpStatus.INFEASIBLE;
        }

        // Phase 2: Optimize original objective
        const phase2Costs = new Array(this.numStructurals + this.numArtificials).fill(0);
        for (let j = 0; j < this.numStructurals; j++) {
            // Standardize on minimization internally
            phase2Costs[j] = maximize ? -costs[j] : costs[j]; 
        }
        
        return this.runSimplex(phase2Costs, false, maxIterations);
    }

    private runSimplex(c: number[], isPhase1: boolean, maxIterations: number): LpStatus {
        let iterations = 0;
        while (true) {
            if (++iterations > maxIterations) {
                return LpStatus.EVALUATION_UNDECIDABLE;
            }

            let entering = -1;

            // Strict Bland's rule: explicitly select the lowest index j with negative reduced cost
            for (let j = 0; j < this.numStructurals + this.numArtificials; j++) {
                if (!isPhase1 && j >= this.numStructurals) {
                    continue; // Bar artificials from re-entering in phase 2
                }

                if (this.basis.includes(j)) continue;

                // Compute reduced cost dynamically rather than tracking an objective row
                let z_j = 0;
                for (let i = 0; i < this.m; i++) {
                    z_j += c[this.basis[i]] * this.tableau[i][j];
                }
                const reducedCost = c[j] - z_j;

                if (reducedCost < -EPS) {
                    entering = j;
                    break; // Bland's rule -> break on first valid
                }
            }

            if (entering === -1) {
                return LpStatus.OPTIMAL;
            }

            let leavingRow = -1;
            let minRatio = Infinity;
            let leavingVarIndex = Infinity;

            for (let i = 0; i < this.m; i++) {
                if (this.tableau[i][entering] > EPS) {
                    const ratio = this.rhs[i] / this.tableau[i][entering];
                    if (ratio < minRatio - EPS) {
                        minRatio = ratio;
                        leavingRow = i;
                        leavingVarIndex = this.basis[i];
                    } else if (Math.abs(ratio - minRatio) <= EPS) {
                        // Tie breaker: Bland's rule -> smallest index leaves
                        if (this.basis[i] < leavingVarIndex) {
                            leavingRow = i;
                            leavingVarIndex = this.basis[i];
                        }
                    }
                }
            }

            if (leavingRow === -1) {
                return LpStatus.UNBOUNDED;
            }

            // Pivot
            const pivotValue = this.tableau[leavingRow][entering];
            for (let j = 0; j < this.numStructurals + this.numArtificials; j++) {
                this.tableau[leavingRow][j] /= pivotValue;
            }
            this.rhs[leavingRow] /= pivotValue;

            for (let i = 0; i < this.m; i++) {
                if (i !== leavingRow) {
                    const factor = this.tableau[i][entering];
                    for (let j = 0; j < this.numStructurals + this.numArtificials; j++) {
                        this.tableau[i][j] -= factor * this.tableau[leavingRow][j];
                    }
                    this.rhs[i] -= factor * this.rhs[leavingRow];
                }
            }

            this.basis[leavingRow] = entering;
        }
    }

    public getObjectiveValue(costs: number[]): number {
        let obj = 0;
        for (let i = 0; i < this.m; i++) {
            if (this.basis[i] < this.numStructurals) {
                obj += costs[this.basis[i]] * this.rhs[i];
            }
        }
        return obj;
    }
}

/**
 * BRUTAL TRUTHS (Physical limitations of this oracle):
 * 
 * 1. The 2^k Explosion (JS Engine limits):
 *    In SPATIAL_EXCHANGEABILITY, this generates the full boolean hypercube (2^k atoms).
 *    Because this is an exact LP over the marginal polytope, the number of columns in the 
 *    tableau scales exponentially. If k (the number of guardrails) exceeds ~15, the V8 heap 
 *    will explode. This is a research oracle for bounding cohort behavior, not a runtime 
 *    firewall for 1,000 parallel agents.
 * 
 * 2. The 32-bit Bitwise Trap:
 *    The atom generation uses `(i >> bit) & 1`. JavaScript bitwise operators coerce numbers 
 *    into 32-bit signed integers. If k ever goes above 31, this logic silently corrupts. 
 *    Given the 2^k memory limit above, you will run out of RAM before you hit 31 bits, 
 *    but mechanically, it is a hidden upper bound.
 * 
 * 3. Floating Point Tolerance (EPS = 1e-9):
 *    JS uses double-precision floats (IEEE 754). While 1e-9 is a great default EPS, large 
 *    tableaus with heavy pivoting can sometimes accumulate drift. If you ever see a test flake 
 *    because artSum is 1.2e-9 when it should be zero, floating point drift is exactly why.
 */
export class LpOracle {
    /**
     * exactBounds computes min/max union and intersection probabilities
     * over the marginal-constrained polytope defined by `marginals` and the `regime`.
     * `maxIterations` enforces the Chaitin one-sided comprehension budget.
     */
    static exactBounds(marginals: number[], regime: Regime, maxIterations: number = 1000): ExactBoundsResult {
        const k = marginals.length;
        const atoms: number[][] = [];
        
        if (regime === Regime.SPATIAL_EXCHANGEABILITY) {
            // Spatial Exchangeability: All 2^k atoms are feasible
            const numAtoms = 1 << k;
            for (let i = 0; i < numAtoms; i++) {
                const atom = [];
                for (let bit = 0; bit < k; bit++) {
                    atom.push((i >> bit) & 1);
                }
                atoms.push(atom);
            }
        } else if (regime === Regime.TEMPORAL_STOPPING) {
            // Temporal Stopping (First-Failure-Abort): Only popcount <= 1 feasible
            // Atom 0: all zeros
            atoms.push(new Array(k).fill(0));
            // Atom 1..k: unit vectors
            for (let i = 0; i < k; i++) {
                const atom = new Array(k).fill(0);
                atom[i] = 1;
                atoms.push(atom);
            }
        } else {
            throw new Error(`Unsupported regime: ${regime}`);
        }

        const n = atoms.length;
        const m = k + 1;

        const A: number[][] = [];
        // Constraint 0: Sum of probabilities = 1
        A.push(new Array(n).fill(1));

        // Constraint 1..k: Marginal probability constraints
        for (let i = 0; i < k; i++) {
            const row = new Array(n).fill(0);
            for (let j = 0; j < n; j++) {
                row[j] = atoms[j][i];
            }
            A.push(row);
        }

        const b = [1, ...marginals];

        const unionCosts = new Array(n).fill(0);
        const intersectionCosts = new Array(n).fill(0);

        for (let j = 0; j < n; j++) {
            const popcount = atoms[j].reduce((sum, val) => sum + val, 0);
            if (popcount >= 1) unionCosts[j] = 1;
            if (popcount === k) intersectionCosts[j] = 1;
        }

        const result: ExactBoundsResult = {
            union: { min: 0, max: 0, status: LpStatus.INFEASIBLE },
            intersection: { min: 0, max: 0, status: LpStatus.INFEASIBLE }
        };

        // Min Union
        const solverMinUnion = new SimplexSolver(A, b);
        let status = solverMinUnion.solve(unionCosts, false, maxIterations);
        result.union.status = status;
        if (status === LpStatus.OPTIMAL) {
            result.union.min = solverMinUnion.getObjectiveValue(unionCosts);
        }

        // Max Union
        const solverMaxUnion = new SimplexSolver(A, b);
        status = solverMaxUnion.solve(unionCosts, true, maxIterations);
        if (status === LpStatus.OPTIMAL) {
            result.union.max = solverMaxUnion.getObjectiveValue(unionCosts);
        }

        // Min Intersection
        const solverMinInter = new SimplexSolver(A, b);
        status = solverMinInter.solve(intersectionCosts, false, maxIterations);
        result.intersection.status = status;
        if (status === LpStatus.OPTIMAL) {
            result.intersection.min = solverMinInter.getObjectiveValue(intersectionCosts);
        }

        // Max Intersection
        const solverMaxInter = new SimplexSolver(A, b);
        status = solverMaxInter.solve(intersectionCosts, true, maxIterations);
        if (status === LpStatus.OPTIMAL) {
            result.intersection.max = solverMaxInter.getObjectiveValue(intersectionCosts);
        }
        
        return result;
    }
}
