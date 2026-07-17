// The comprehension gate: admit only what is CERTIFIED simple; fail closed on
// everything else.
//
// Verdict semantics (one-sided by construction):
//   WITHIN_BUDGET            U(x) <= B  — the payload is certifiably within the
//                            evaluator's comprehension budget for this
//                            toolchain. A statement about x.
//   EVALUATION_UNDECIDABLE   U(x) >  B  — NOT a statement that x is complex,
//                            malicious, or beyond the evaluator. It records
//                            only that x was not certified comprehensible:
//                            true complexity and mere compressor-opacity are
//                            indistinguishable here, provably so (K is
//                            uncomputable). The gate trades completeness
//                            (structurally simple but opaque payloads are
//                            refused — see the PRNG keystone test) for a
//                            sound admission rule.
//
// Intended composition (stated, not wired): strictly UPSTREAM of the semantic
// gate (Gate 3). The semantic gate aggregates supplied marginals; this gate
// bounds what any bounded assessor was even in a position to evaluate. It is a
// standalone research module — integration into the enforcement runtime is
// future work and no runtime coupling is claimed.
//
// B is an explicit policy parameter. evaluatorAnchoredBudget() offers a
// Chaitin-INSPIRED default (see complexityBudget.ts); it is a policy choice,
// never a derivation of any incompleteness constant.
//
// No maturity annotation: pure computation; the signed receipt layer
// (receipt.ts) carries the annotations.

import { type UpperBoundWitness, upperBound } from "./complexityBudget";

export type ComprehensionStatus = "WITHIN_BUDGET" | "EVALUATION_UNDECIDABLE";

export interface ComprehensionVerdict {
  readonly status: ComprehensionStatus;
  readonly budget_bytes: number;
  readonly witness: UpperBoundWitness;
  readonly note: string;
}

export function evaluateComprehension(
  payload: Uint8Array | string,
  budgetBytes: number,
): ComprehensionVerdict {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 0) {
    throw new Error("comprehension budget must be a non-negative integer byte count");
  }
  const witness = upperBound(payload);
  if (witness.upper_bound_bytes <= budgetBytes) {
    return {
      status: "WITHIN_BUDGET",
      budget_bytes: budgetBytes,
      witness,
      note: `certified: U(x)=${witness.upper_bound_bytes}B <= budget ${budgetBytes}B (toolchain-relative upper bound on description length)`,
    };
  }
  return {
    status: "EVALUATION_UNDECIDABLE",
    budget_bytes: budgetBytes,
    witness,
    note:
      `refused (fail-closed): U(x)=${witness.upper_bound_bytes}B > budget ${budgetBytes}B. ` +
      "Not certified comprehensible — NOT a finding that the payload is complex or malicious; " +
      "true complexity and compressor-opacity are indistinguishable here (K is uncomputable).",
  };
}
