// Runnable Löbian-obstacle demonstration.
//
//   npx ts-node packages/research-frontier/src/lobian/demo.ts
//
// An agent tries to license a same-strength successor by proving its soundness;
// the GL decision procedure refutes the obligation and Ghost-Ark records the
// countermodel as a verifiable receipt. Digests are deterministic (fixed
// timestamp) so the run reproduces byte-for-byte.

import { atom, show } from "./formula";
import { isGLFrame, refutes, canonicalModel } from "./kripke";
import { decide } from "./glTableau";
import { demonstrateLobianObstacle, evaluateObligation, licensingObligations } from "./lobianObstacle";
import { buildReceipt, verifyReceipt, agentDigest } from "./receipt";

const line = "-".repeat(72);
const TS = "2026-07-17T00:00:00Z"; // fixed → reproducible digests

const invariant = atom("fail_closed"); // "every governed invoke fails closed"
const agent = agentDigest({ name: "successor-A-prime", strength: "same", policy: "relaxed-logging" });

console.log("Ghost-Ark — Runnable Löbian Obstacle Demonstrator (GHOST-LOBIAN-V1)");
console.log(`invariant φ = ${show(invariant)}   successor agent = ${agent}`);
console.log(line);
console.log(
  "Scenario: agent A must license a same-strength successor A' that preserves φ.\n" +
    "Read □ψ as 'A' proves ψ'. A tries three licensing obligations.\n",
);

const report = demonstrateLobianObstacle(invariant);
for (const o of licensingObligations(invariant)) {
  const v = evaluateObligation(o);
  const receipt = buildReceipt(v, agent, TS);
  const check = verifyReceipt(receipt);

  console.log(line);
  console.log(`OBLIGATION [${o.kind}]: prove  ${show(o.formula)}`);
  console.log(`  ${o.description}`);
  console.log(`  VERDICT: ${v.status}`);
  console.log(`  note: ${v.note}`);
  if (v.status === "LICENSE_REFUTED") {
    const cm = canonicalModel(v.countermodel);
    console.log(`  countermodel worlds: ${JSON.stringify(cm.worlds)}`);
    console.log(`  accessibility R:     ${JSON.stringify(cm.edges)}`);
    console.log(`  valuation:           ${JSON.stringify(cm.valuation)}`);
    console.log(
      `  cross-check: GLframe=${isGLFrame(v.countermodel)} refutes(φ)=${refutes(v.countermodel, v.root, o.formula)}`,
    );
  } else {
    console.log(`  proof: closed tableau (theorem); evidence = ${receipt.evidence.kind}`);
  }
  console.log(`  RECEIPT ${receipt.protocol} status=${receipt.status}`);
  console.log(`    content_digest: ${receipt.content_digest}`);
  console.log(`    signature:      ${receipt.signature.slice(0, 32)}… (dev-hmac)`);
  console.log(
    `    verify: valid=${check.valid}  {digest:${check.checks.digest_matches}, sig:${check.checks.signature_matches}, evidence_replays:${check.checks.evidence_replays}}`,
  );
}

console.log(line);
console.log(`OBSTACLE HIT: ${report.obstacleHit} (≥1 obligation refuted → recorded, not licensed)`);

// Honest performance: small-formula decision timings. GL-satisfiability is
// PSPACE-complete; these are NOT a throughput floor and must never be quoted as
// one. They report the actual cost of deciding the demo's formulas.
console.log(line);
console.log("Decision-procedure cost (small formulas; GL-SAT is PSPACE-complete — NOT a throughput claim):");
for (const [name, phi] of [
  ["Löb □(□p→p)→□p", licensingObligations(atom("p"))[2].formula],
  ["naive-soundness □p→p", licensingObligations(atom("p"))[0].formula],
  ["consistency ¬□⊥", licensingObligations(atom("p"))[1].formula],
] as const) {
  const r = decide(phi);
  console.log(
    `  ${name.padEnd(24)} theorem=${String(r.theorem).padEnd(5)} nodes=${String(r.stats.nodesExplored).padStart(4)} time=${r.stats.elapsedMs}ms`,
  );
}

console.log(line);
console.log(
  "CLAIM BOUNDARY: this demonstrator decides Gödel–Löb provability logic and\n" +
    "records countermodels. It does NOT prove any agent, model, or system safe,\n" +
    "sound, aligned, or consistent — those proofs are provably unavailable (Löb /\n" +
    "Gödel G2). A receipt is evidence that boundary code reached a verdict with a\n" +
    "replayable witness; it is not an endorsement of any payload. No hardware\n" +
    "attestation and no throughput floor is claimed here.",
);
