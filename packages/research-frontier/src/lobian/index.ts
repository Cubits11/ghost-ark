// Löbian obstacle demonstrator for Ghost-Ark: a runnable Gödel–Löb decision
// procedure whose refutations become replayable cryptographic evidence.
//
// Claim boundary: this package decides Gödel–Löb provability logic and records
// countermodels. It does NOT prove any agent, model, or system is safe, sound,
// aligned, or consistent — the whole point is that such proofs are unavailable
// (Löb / Gödel G2), and the receipt is evidence of that unavailability.

export * from "./formula";
export * from "./kripke";
export * from "./glTableau";
export * from "./lobianObstacle";
export * from "./receipt";
