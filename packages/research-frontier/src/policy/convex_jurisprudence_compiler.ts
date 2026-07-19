import { canonicalStateDigest } from '../verifier/crypto_marshal';

// A strict bounding constraint: A_i * X <= b_i
export interface GeometricConstraint {
    id: string;
    coefficients: number[]; // The row matrix A_i
    bound: number;          // The limit b_i
    description: string;
}

/**
 * Convex constraint set (intersection of half-spaces, Ax <= b).
 *
 * Compiles declared numeric policy bounds into linear inequalities and tests
 * whether a vector lies inside the resulting convex region. This is exact
 * linear algebra over declared marginals - not a semantic/NLP evaluation of
 * intent, and it decides nothing about resources or operations outside the
 * numeric dimensions it is given.
 */
export class ConvexJurisprudenceMatrix {
    private constraints: GeometricConstraint[] = [];
    private dimensions: number;

    constructor(dimensions: number) {
        this.dimensions = dimensions;
    }

    /**
     * Compiles abstract human policy into hyperplanes.
     * Example: "Model cannot exceed 3% exposure while drawing high execution limits"
     */
    public compileHumanLawToHyperplane(id: string, coefficients: number[], bound: number, description: string) {
        if (coefficients.length !== this.dimensions) {
            throw new Error("Geometric Mismatch: Law dimensions do not match Vector geometry.");
        }
        this.constraints.push({ id, coefficients, bound, description });
    }

    /**
     * Tests whether vector V satisfies every declared inequality (A_i . V <= b_i).
     * Returns SAFE if V is inside the convex region, or GEOMETRIC_COLLISION with
     * the first violated constraint and an unsigned digest of the violation record.
     */
    public verifyTrajectory(vectorV: number[]): { status: 'SAFE' | 'GEOMETRIC_COLLISION', interceptPlane?: GeometricConstraint, witnessHash?: string } {
        for (const plane of this.constraints) {
            let dotProduct = 0;
            for (let i = 0; i < this.dimensions; i++) {
                dotProduct += vectorV[i] * plane.coefficients[i];
            }

            // Ax > b mathematically implies intercepting the bounding hyperplane
            if (dotProduct > plane.bound) {
                const witness = canonicalStateDigest({
                    type: "GEOMETRIC_COLLISION",
                    vector: vectorV,
                    hyperplane_id: plane.id,
                    intercept_val: dotProduct,
                    limit: plane.bound
                });

                return {
                    status: 'GEOMETRIC_COLLISION',
                    interceptPlane: plane,
                    witnessHash: witness.hashHex
                };
            }
        }

        return { status: 'SAFE' };
    }
}
