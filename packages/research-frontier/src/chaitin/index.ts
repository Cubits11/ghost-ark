// Q2 — the epistemic ceiling, honestly instrumented.
//
// Claim boundary: Kolmogorov complexity is uncomputable, so nothing here
// measures K or detects an "outcomplexed" evaluator. The gate certifies
// SIMPLICITY via computable compression upper bounds and fails closed on
// everything else (EVALUATION_UNDECIDABLE = "not certified comprehensible",
// never "known complex/malicious"). Budgets are explicit policy parameters;
// the evaluator-anchored default is Chaitin-inspired, not Chaitin-derived.

export * from "./complexityBudget";
export * from "./comprehensionGate";
export * from "./receipt";
